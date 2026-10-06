// HTTP API routes for the web frontend: login, logout, /me, key management.
// Mounted by src/index.ts BEFORE the /mcp handler when MCP_TRANSPORT=http.
// All routes are JSON + same-origin (httpOnly session cookie); CORS is not
// needed because the frontend is served from the same origin via reverse-proxy.
//
// Cookie name: sudrf_session — httpOnly, SameSite=Lax, 30-day TTL.
// The /mcp endpoint still does bearer auth (per-user key), independent of
// these cookie-authed routes.

import { type IncomingMessage, type ServerResponse } from "node:http";
import type { AuthStore, ApiKey, User } from "./store.js";
import { ProfileUpdateError } from "./store.js";
import type { OAuthStore } from "./oauth.js";
import type { RagIndex } from "../rag/index.js";
import type { CaseCatalog } from "../cases/store.js";
import type { CaseParserScheduler } from "../parser/scheduler.js";
import type { Tier2ParserScheduler } from "../parser/tier2-scheduler.js";
import type { SudrfClient } from "../sudrf/index.js";
import type { ParticipantSearchJobStore } from "../participant/jobs.js";
import {
  buildParticipantDossier,
  startParticipantDeepSearch,
  formatParticipantSearchJob,
} from "../participant/dossier.js";
import { listLawyerCards, getLawyerCard, findCardForProfile, profileDisplayName, lawyerHeatmap, warmLawyerIndex, isLawyerIndexReady } from "../lawyers/aggregate.js";
import { serializeParserStats } from "../parser/stats-view.js";
import { enrichCaseFromHtml } from "../parser/enrich-html.js";
import { computeCoverage } from "../analytics/coverage.js";
import { computeCollectionRate } from "../analytics/collection-rate.js";
import { buildMordoviaDashboard } from "../analytics/region-dashboard.js";
import { generateMordoviaInsights } from "../ai/insights.js";
import { generateCardInsight, type CardAiKind, type CardAiMode } from "../ai/card-insights.js";
import { claudeHubConfigured } from "../ai/claudehub.js";
import {
  buildParticipantDossier as buildCatalogPersonDossier,
  listParticipants,
  warmParticipantIndex,
  ROLE_FAMILY_LABELS,
} from "../participants/aggregate.js";
import { DISPLAY_REGION, displayRegionLabel, isDisplayRegionScoped } from "../config/display-scope.js";
import { COURT_REGISTRY } from "../sudrf/courts.js";
import { resolveEntity } from "../entities/index.js";
import {
  SearchCollectedSchema,
  getCatalogDocument,
  searchCollectedCatalog,
} from "../catalog/tools.js";
import { getWaitlistStore } from "../waitlist/store.js";

const SESSION_COOKIE = "sudrf_session";
const SESSION_TTL_S = 60 * 60 * 24 * 30; // 30 days, matches store.ts

/** Soft cache for heavy analytics at 70k+ catalog size. */
const ANALYTICS_CACHE_MS = 60_000;
let mordoviaDashCache: { at: number; size: number; data: ReturnType<typeof buildMordoviaDashboard> } | null = null;
let coverageCache: { at: number; size: number; key: string; data: unknown } | null = null;

function cachedMordoviaDashboard(catalog: CaseCatalog) {
  const now = Date.now();
  if (
    mordoviaDashCache
    && mordoviaDashCache.size === catalog.size
    && now - mordoviaDashCache.at < ANALYTICS_CACHE_MS
  ) {
    return mordoviaDashCache.data;
  }
  const data = buildMordoviaDashboard(catalog);
  mordoviaDashCache = { at: now, size: catalog.size, data };
  return data;
}

interface PublicUser {
  id: string;
  email: string;
  role: "admin" | "user";
  createdAt: string;
  profile?: User["profile"];
}

interface PublicKey {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt?: string;
  // token is only returned at creation/rotation, never in list views
  token?: string;
}

function publicUser(u: User): PublicUser {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    createdAt: u.createdAt,
    profile: u.profile,
  };
}

function publicKey(k: ApiKey, includeToken = false): PublicKey {
  const out: PublicKey = { id: k.id, label: k.label, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt };
  if (includeToken) out.token = k.token;
  return out;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c: Buffer) => { data += c.toString("utf8"); });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers["cookie"] ?? "";
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

// application/x-www-form-urlencoded → flat string map (same parser as oauth-routes).
function parseForm(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of body.split("&")) {
    if (!pair) continue;
    const i = pair.indexOf("=");
    const k = decodeURIComponent(i < 0 ? pair : pair.slice(0, i)).replace(/\+/g, " ");
    const v = decodeURIComponent(i < 0 ? "" : pair.slice(i + 1)).replace(/\+/g, " ");
    out[k] = v;
  }
  return out;
}

// A `next` target is safe to redirect to only if it's a same-origin path
// (starts with / and is not //host). Prevents open-redirect via the login form.
function isSameOriginPath(target: string): boolean {
  if (!target.startsWith("/")) return false;
  if (target.startsWith("//")) return false; // protocol-relative URL → foreign host
  return true;
}

function setSessionCookie(res: ServerResponse, sid: string): void {
  res.setHeader("set-cookie", `${SESSION_COOKIE}=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_S}`);
}

function clearSessionCookie(res: ServerResponse): void {
  res.setHeader("set-cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

// Resolve the session user from the cookie, or null.
function currentUser(req: IncomingMessage, store: AuthStore): User | null {
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (!sid) return null;
  return store.getUserBySession(sid) ?? null;
}

// Main entry: handle a request if it targets /api/*, return true if handled.
function isLocalRequest(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

export async function handleApiRoute(
  req: IncomingMessage,
  res: ServerResponse,
  store: AuthStore,
  mcpEndpoint: string,
  oauth: OAuthStore,
  rag?: RagIndex,
  scheduler?: CaseParserScheduler,
  catalog?: CaseCatalog,
  sudrf?: SudrfClient,
  participantJobs?: ParticipantSearchJobStore,
  tier2Scheduler?: Tier2ParserScheduler,
  saveRag?: () => void,
): Promise<boolean> {
  const url = req.url ?? "";
  if (!url.startsWith("/api/")) return false;

  const path = url.split("?")[0];

  // POST /api/waitlist — early access (public, requires privacy consent)
  if (path === "/api/waitlist" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req)) as {
        email?: string;
        name?: string;
        note?: string;
        consent?: boolean;
        privacyVersion?: string;
      };
      if (!body.email?.trim()) {
        return json(res, 400, { error: "укажите email" }), true;
      }
      if (!body.consent) {
        return json(res, 400, { error: "нужно согласие с политикой обработки данных" }), true;
      }
      const entry = getWaitlistStore().add({
        email: body.email,
        name: body.name,
        note: body.note,
        consent: true,
        privacyVersion: body.privacyVersion,
      });
      return json(res, 200, { ok: true, id: entry.id }), true;
    } catch (e) {
      return json(res, 400, { error: e instanceof Error ? e.message : String(e) }), true;
    }
  }

  // POST /api/internal/enrich-html — Go worker posts fetched HTML (localhost only)
  if (path === "/api/internal/enrich-html" && req.method === "POST") {
    if (!isLocalRequest(req)) return json(res, 403, { error: "forbidden" }), true;
    if (!catalog || !rag || !sudrf || !saveRag) {
      return json(res, 503, { error: "enrich not available" }), true;
    }
    try {
      const body = JSON.parse(await readBody(req)) as {
        id?: string;
        courtSubdomain?: string;
        caseUrl?: string;
        html?: string;
      };
      const id = body.id?.trim();
      const courtSubdomain = body.courtSubdomain?.trim();
      const caseUrl = body.caseUrl?.trim();
      const html = body.html;
      if (!id || !courtSubdomain || !caseUrl || !html) {
        return json(res, 400, { error: "id, courtSubdomain, caseUrl, html required" }), true;
      }
      const result = enrichCaseFromHtml(catalog, rag, sudrf, saveRag, {
        id, courtSubdomain, caseUrl, html,
      });
      return json(res, 200, result), true;
    } catch (e) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e) }), true;
    }
  }

  // GET /api/internal/pending-enrich — enrich queue without loading catalog in Go (localhost only)
  if (path === "/api/internal/pending-enrich" && req.method === "GET") {
    if (!isLocalRequest(req)) return json(res, 403, { error: "forbidden" }), true;
    if (!catalog) return json(res, 503, { error: "catalog not available" }), true;
    const q = new URLSearchParams(url.split("?")[1] ?? "");
    const region = q.get("region")?.trim() || DISPLAY_REGION;
    const limit = Math.min(Math.max(Number(q.get("limit") ?? 25), 1), 200);
    const cases = catalog.listPendingEnrichment(limit, { region }).map((c) => ({
      id: c.id,
      caseNumber: c.caseNumber,
      courtSubdomain: c.courtSubdomain,
      caseUrl: c.caseUrl,
    }));
    return json(res, 200, { cases }), true;
  }

  // GET /api/internal/catalog-stats — lightweight stats for Go worker (localhost only)
  if (path === "/api/internal/catalog-stats" && req.method === "GET") {
    if (!isLocalRequest(req)) return json(res, 403, { error: "forbidden" }), true;
    if (!catalog) return json(res, 503, { error: "catalog not available" }), true;
    const q = new URLSearchParams(url.split("?")[1] ?? "");
    const region = q.get("region")?.trim() || DISPLAY_REGION;
    const enrich = catalog.enrichmentStats();
    let size = catalog.size;
    let pending = enrich.pending;
    if (region) {
      const scoped = catalog.list({ region, limit: 1, offset: 0 });
      size = scoped.total;
      pending = catalog.countPendingEnrichment({ region });
    }
    return json(res, 200, { size, pending, region }), true;
  }

  // POST /api/internal/upsert-hearing — Tier-1 schedule ingest via Node single-writer (localhost only)
  if (path === "/api/internal/upsert-hearing" && req.method === "POST") {
    if (!isLocalRequest(req)) return json(res, 403, { error: "forbidden" }), true;
    if (!catalog) return json(res, 503, { error: "catalog not available" }), true;
    try {
      const body = JSON.parse(await readBody(req)) as {
        court?: { subdomain?: string; name?: string; region?: string };
        hearings?: Array<{
          caseNumber?: string;
          caseUid?: string;
          parties?: string;
          category?: string;
          judge?: string;
          courtroom?: string;
          hearingTime?: string;
          hearingDate?: string;
          caseUrl?: string;
        }>;
      };
      const subdomain = body.court?.subdomain?.trim();
      if (!subdomain || !body.hearings?.length) {
        return json(res, 400, { error: "court.subdomain and hearings[] required" }), true;
      }
      const registry = COURT_REGISTRY.find((c) => c.subdomain === subdomain);
      const court: typeof COURT_REGISTRY[number] = registry ?? {
        subdomain,
        name: body.court?.name?.trim() || subdomain,
        region: body.court?.region?.trim() || DISPLAY_REGION,
        type: "ray",
        vnkod: "",
        captcha: true,
        http: true,
      };
      let newCount = 0;
      for (const h of body.hearings) {
        if (!h.caseNumber?.trim()) continue;
        if (isDisplayRegionScoped() && court.region !== DISPLAY_REGION) continue;
        const isNew = catalog.upsertFromHearing(court, {
          caseNumber: h.caseNumber.trim(),
          caseUid: h.caseUid?.trim(),
          parties: h.parties?.trim() ?? "",
          category: h.category?.trim() ?? "",
          judge: h.judge?.trim() ?? "",
          courtroom: h.courtroom?.trim(),
          hearingTime: h.hearingTime?.trim(),
          hearingDate: h.hearingDate?.trim() ?? "",
          caseUrl: h.caseUrl?.trim(),
        });
        if (isNew) newCount++;
      }
      catalog.flush();
      return json(res, 200, { newCount, catalogSize: catalog.size }), true;
    } catch (e) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e) }), true;
    }
  }

  const user = currentUser(req, store);

  // GET /api/me/player-card — FIFA card for logged-in user (by profile FIO)
  if (path === "/api/me/player-card" && req.method === "GET") {
    if (!user) return json(res, 401, { error: "unauthorized" }), true;
    if (!catalog) return json(res, 503, { error: "Case catalog not available" }), true;

    const p = user.profile;
    if (!p?.firstName?.trim() || !p?.lastName?.trim()) {
      return json(res, 200, {
        status: "need_profile",
        message: "Укажите имя и фамилию в профиле — по ним ищем ваши дела в каталоге.",
      }), true;
    }

    const preferRole = p.participantRole === "other" ? undefined : p.participantRole;
    const card = findCardForProfile(catalog, p, preferRole);

    if (card) {
      return json(res, 200, {
        status: "found",
        card,
        isLawyer: card.primaryRole === "lawyer" || card.roles.includes("lawyer"),
        isJudge: card.primaryRole === "judge" || card.roles.includes("judge"),
      }), true;
    }

    if (p.participantRole === "lawyer" || p.participantRole === "judge") {
      return json(res, 200, {
        status: "waiting",
        participantRole: p.participantRole,
        displayName: profileDisplayName(p),
        message:
          p.participantRole === "lawyer"
            ? "Карточка появится, когда парсер найдёт вас представителем в делах каталога."
            : "Карточка появится, когда в каталоге будут дела с вами как судьёй.",
      }), true;
    }

    return json(res, 200, {
      status: "none",
      message: "Укажите в профиле роль «Юрист» или «Судья», чтобы получить игровую карточку. Роль «Пользователь» — без карточки участника.",
    }), true;
  }

  // POST /api/register — signup via invite link
  if (path === "/api/register" && req.method === "POST") {
    const body = JSON.parse(await readBody(req)) as {
      token?: string;
      email?: string;
      password?: string;
      firstName?: string;
      lastName?: string;
      patronymic?: string;
      city?: string;
      company?: string;
      bio?: string;
      participantRole?: "lawyer" | "judge" | "other";
    };
    const token = body.token?.trim();
    const email = body.email?.trim();
    const password = body.password ?? "";
    const firstName = body.firstName?.trim();
    const lastName = body.lastName?.trim();
    if (!token || !email || !password || !firstName || !lastName) {
      return json(res, 400, { error: "token, email, password, firstName, lastName required" }), true;
    }
    try {
      const created = store.registerWithInvite(token, email, password, {
        firstName,
        lastName,
        patronymic: body.patronymic?.trim() || undefined,
        city: body.city?.trim() || undefined,
        company: body.company?.trim() || undefined,
        bio: body.bio?.trim() || undefined,
        participantRole: body.participantRole ?? "other",
        participantRoleChangedAt: new Date().toISOString(),
      });
      const sid = store.createSession(created.id);
      setSessionCookie(res, sid);
      return json(res, 201, { user: publicUser(created) }), true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return json(res, 400, { error: msg }), true;
    }
  }

  // GET /api/invites — list invites created by current user
  if (path === "/api/invites" && req.method === "GET") {
    if (!user) return json(res, 401, { error: "unauthorized" }), true;
    const invites = store.listInvitesForUser(user.id).map((i) => ({
      id: i.id,
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
      usedAt: i.usedAt,
      url: `${new URL(url, "http://x").origin}/#/register?invite=${i.token}`,
    }));
    return json(res, 200, {
      invites,
      usedThisWeek: store.invitesThisWeek(user.id),
      limitPerWeek: 4,
      remaining: Math.max(0, 4 - store.invitesThisWeek(user.id)),
    }), true;
  }

  // POST /api/invites — create invite link
  if (path === "/api/invites" && req.method === "POST") {
    if (!user) return json(res, 401, { error: "unauthorized" }), true;
    try {
      const invite = store.createInvite(user.id);
      const origin = req.headers["x-forwarded-host"]
        ? `https://${req.headers["x-forwarded-host"]}`
        : "https://a2chatsky.ru";
      return json(res, 201, {
        invite: {
          id: invite.id,
          expiresAt: invite.expiresAt,
          url: `${origin}/#/register?invite=${invite.token}`,
        },
        remaining: Math.max(0, 4 - store.invitesThisWeek(user.id)),
      }), true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return json(res, 400, { error: msg }), true;
    }
  }

  // PATCH /api/profile — update user profile
  if (path === "/api/profile" && req.method === "PATCH") {
    if (!user) return json(res, 401, { error: "unauthorized" }), true;
    const body = JSON.parse(await readBody(req)) as Partial<NonNullable<User["profile"]>>;
    try {
      const updated = store.updateProfile(user.id, body);
      if (!updated) return json(res, 404, { error: "not found" }), true;
      return json(res, 200, { user: publicUser(updated) }), true;
    } catch (e) {
      if (e instanceof ProfileUpdateError) {
        return json(res, 429, {
          error: e.message,
          code: e.code,
          nextChangeAt: e.nextChangeAt,
        }), true;
      }
      throw e;
    }
  }

  // POST /api/login ──────────────────────────────────────────────────
  // Two content shapes are accepted:
  //   • application/json { email, password }  — the cabinet SPA (fetch). Returns
  //     JSON { user } and the SPA navigates client-side.
  //   • application/x-www-form-urlencoded      — the server-rendered login form
  //     shown by /authorize when no session is present. With a ?next=<url> query
  //     param (same origin) it 302-redirects back there after setting the
  //     cookie, so the OAuth consent flow resumes on a server-rendered page.
  if (path === "/api/login" && req.method === "POST") {
    if (user) return json(res, 200, { user: publicUser(user) }), true;
    const raw = await readBody(req);
    const ct = (req.headers["content-type"] ?? "").toLowerCase();
    let email: string, password: string;
    if (ct.includes("application/x-www-form-urlencoded")) {
      const form = parseForm(raw);
      email = form.email ?? "";
      password = form.password ?? "";
    } else {
      const body = JSON.parse(raw) as { email?: string; password?: string };
      email = body.email ?? "";
      password = body.password ?? "";
    }
    const found = store.verifyCredentials(email, password);
    if (!found) {
      // For form submissions with a next URL, re-render the authorize login
      // page with an error message instead of a bare JSON 401.
      const next = new URL(url, "http://x").searchParams.get("next");
      if (next && isSameOriginPath(next)) {
        res.writeHead(302, { location: next + (next.includes("?") ? "&" : "?") + "error=" + encodeURIComponent("неверный email или пароль") });
        res.end();
        return true;
      }
      return json(res, 401, { error: "неверный email или пароль" }), true;
    }
    const sid = store.createSession(found.id);
    setSessionCookie(res, sid);
    const next = new URL(url, "http://x").searchParams.get("next");
    if (next && isSameOriginPath(next)) {
      res.writeHead(302, { location: next });
      res.end();
      return true;
    }
    return json(res, 200, { user: publicUser(found) }), true;
  }

  // ── POST /api/logout ─────────────────────────────────────────────────
  if (path === "/api/logout" && req.method === "POST") {
    const sid = parseCookies(req)[SESSION_COOKIE];
    if (sid) store.destroySession(sid);
    clearSessionCookie(res);
    return json(res, 200, { ok: true }), true;
  }

  // ── GET /api/me ──────────────────────────────────────────────────────
  if (path === "/api/me" && req.method === "GET") {
    if (!user) return json(res, 401, { error: "not authenticated" }), true;
    return json(res, 200, { user: publicUser(user) }), true;
  }

  // Everything below requires an authenticated session.
  if (!user) return json(res, 401, { error: "not authenticated" }), true;

  // ── GET /api/keys ── list current user's keys (no tokens) ────────────
  if (path === "/api/keys" && req.method === "GET") {
    const keys = store.listKeysForUser(user.id).map((k) => publicKey(k));
    return json(res, 200, { keys, mcpEndpoint }), true;
  }

  // ── POST /api/keys ── create a new key, return token once ────────────
  if (path === "/api/keys" && req.method === "POST") {
    const body = JSON.parse(await readBody(req)) as { label?: string };
    const key = store.createKey(user.id, body.label?.trim() || "default");
    return json(res, 201, { key: publicKey(key, true), mcpEndpoint }), true;
  }

  // ── DELETE /api/keys?id=… ── revoke a key ────────────────────────────
  if (path === "/api/keys" && req.method === "DELETE") {
    const id = new URL(url, "http://x").searchParams.get("id");
    if (!id) return json(res, 400, { error: "id required" }), true;
    const ok = store.deleteKey(user.id, id);
    return json(res, ok ? 200 : 404, ok ? { ok: true } : { error: "not found" }), true;
  }

  // ── GET /api/endpoint ── the MCP URL + how to use the key ────────────
  if (path === "/api/endpoint" && req.method === "GET") {
    return json(res, 200, { mcpEndpoint }), true;
  }

  // ── OAuth sessions: which AI agents the user has authorized ──────────
  // GET  /api/oauth/sessions — list authorized clients + active tokens
  // DELETE /api/oauth/sessions?clientId=… — disconnect one agent (revoke its tokens)
  if (path === "/api/oauth/sessions" && req.method === "GET") {
    const clients = oauth.listClientsForUser(user.id).map((c) => ({
      clientId: c.clientId,
      clientName: c.clientName,
      redirectUris: c.redirectUris,
      scope: c.scope,
      createdAt: c.createdAt,
    }));
    const tokens = oauth.listTokensForUser(user.id).map((t) => ({
      clientId: t.clientId,
      scope: t.scope,
      createdAt: t.createdAt,
      expiresAt: t.expiresAt,
      // accessToken masked — cabinet only shows a fingerprint, never the secret
      fingerprint: t.accessToken.slice(0, 8) + "…" + t.accessToken.slice(-4),
    }));
    return json(res, 200, { clients, tokens, mcpEndpoint }), true;
  }
  if (path === "/api/oauth/sessions" && req.method === "DELETE") {
    const clientId = new URL(url, "http://x").searchParams.get("clientId");
    if (!clientId) return json(res, 400, { error: "clientId required" }), true;
    const removed = oauth.revokeClientForUser(user.id, clientId);
    return json(res, removed > 0 ? 200 : 404, removed > 0 ? { ok: true, revoked: removed } : { error: "not found" }), true;
  }

  // ── Admin routes (role === "admin") ──────────────────────────────────
  // Invite-only user management from the cabinet.
  if (path === "/api/admin/users" && req.method === "GET") {
    if (user.role !== "admin") return json(res, 403, { error: "forbidden" }), true;
    const users = store.listUsers().map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt,
      keys: store.listKeysForUser(u.id).length,
    }));
    return json(res, 200, { users }), true;
  }

  // Invite a new user: POST /api/admin/users { email, password, role? }
  if (path === "/api/admin/users" && req.method === "POST") {
    if (user.role !== "admin") return json(res, 403, { error: "forbidden" }), true;
    const body = JSON.parse(await readBody(req)) as { email?: string; password?: string; role?: "admin" | "user" };
    const email = body.email?.trim();
    const password = body.password ?? "";
    if (!email || password.length < 6) {
      return json(res, 400, { error: "укажите email и пароль (мин. 6 символов)" }), true;
    }
    try {
      const created = store.createUser(email, password, body.role === "admin" ? "admin" : "user");
      return json(res, 201, { user: publicUser(created) }), true;
    } catch (e) {
      return json(res, 400, { error: e instanceof Error ? e.message : "ошибка" }), true;
    }
  }

  // Remove a user (cascades their keys + sessions): DELETE /api/admin/users?id=…
  if (path === "/api/admin/users" && req.method === "DELETE") {
    if (user.role !== "admin") return json(res, 403, { error: "forbidden" }), true;
    const id = new URL(url, "http://x").searchParams.get("id");
    if (!id) return json(res, 400, { error: "id required" }), true;
    if (id === user.id) return json(res, 400, { error: "нельзя удалить себя" }), true;
    const ok = store.deleteUser(id);
    return json(res, ok ? 200 : 404, ok ? { ok: true } : { error: "not found" }), true;
  }

  // GET /api/admin/waitlist — early-access applications (SMTP later)
  if (path === "/api/admin/waitlist" && req.method === "GET") {
    if (!user || user.role !== "admin") return json(res, 403, { error: "forbidden" }), true;
    const entries = getWaitlistStore().list();
    return json(res, 200, {
      entries,
      smtpReady: false,
      note: "SMTP ещё не подключён — заявки только в этой панели.",
    }), true;
  }

  // ── Cabinet: case catalog & parser (session auth for the web UI) ───────
  const params = new URL(url, "http://x").searchParams;

  // GET /api/cases/search-collected?q=… — unified catalog + RAG search
  if (path === "/api/cases/search-collected" && req.method === "GET") {
    if (!catalog) return json(res, 503, { error: "Case catalog not available" }), true;
    if (!rag) return json(res, 503, { error: "RAG not available" }), true;
    const q = params.get("q") ?? params.get("query") ?? "";
    if (!q.trim()) return json(res, 400, { error: "q required" }), true;
    const input = SearchCollectedSchema.parse({
      query: q,
      limit: Number(params.get("limit") ?? 20),
      region: params.get("region") ?? undefined,
      court: params.get("court") ?? undefined,
      caseNumber: params.get("caseNumber") ?? undefined,
      participant: params.get("participant") ?? undefined,
      judge: params.get("judge") ?? undefined,
    });
    return json(res, 200, searchCollectedCatalog(catalog, rag, input)), true;
  }

  // GET /api/cases — search/list cases (catalog)
  if (path === "/api/cases" && req.method === "GET") {
    if (!catalog) return json(res, 503, { error: "Case catalog not available" }), true;
    const regionParam = params.get("region");
    const region = regionParam && regionParam !== "all"
      ? regionParam
      : (isDisplayRegionScoped() ? DISPLAY_REGION : undefined);
    const result = catalog.list({
      q: params.get("q") ?? undefined,
      caseNumber: params.get("caseNumber") ?? undefined,
      uid: params.get("uid") ?? undefined,
      participant: params.get("participant") ?? undefined,
      participantRole: params.get("participantRole") ?? params.get("role") ?? undefined,
      judge: params.get("judge") ?? undefined,
      court: params.get("court") ?? undefined,
      region,
      category: params.get("category") ?? undefined,
      categoryGroup: params.get("categoryGroup") ?? undefined,
      hasDocuments: params.get("hasDocuments") === "1" || params.get("hasDocuments") === "true",
      enriched: params.get("enriched") === "1" || params.get("enriched") === "true",
      hearingFrom: params.get("hearingFrom") ?? params.get("from") ?? undefined,
      hearingTo: params.get("hearingTo") ?? params.get("to") ?? undefined,
      limit: Math.min(Math.max(Number(params.get("limit") ?? 50), 1), 100),
      offset: Number(params.get("offset") ?? 0),
    });
    return json(res, 200, result), true;
  }

  // GET /api/participants — all roles (ПРЕДСТАВИТЕЛЬ, истец, ответчик, …)
  if (path === "/api/participants" && req.method === "GET") {
    if (!user) return json(res, 401, { error: "unauthorized" }), true;
    if (!catalog) return json(res, 503, { error: "Case catalog not available" }), true;
    try {
      warmParticipantIndex(catalog);
      const result = listParticipants(catalog, {
        q: params.get("q") ?? undefined,
        role: params.get("role") ?? undefined,
        limit: Number(params.get("limit") ?? 48),
        offset: Number(params.get("offset") ?? 0),
        minCases: Number(params.get("minCases") ?? 1),
      });
      return json(res, 200, { ...result, roleLabels: ROLE_FAMILY_LABELS }), true;
    } catch (e) {
      return json(res, 500, {
        error: e instanceof Error ? e.message : String(e),
        total: 0,
        people: [],
        facets: [],
        indexReady: false,
      }), true;
    }
  }

  // GET /api/participants/detail?id=… | ?name=…&role=representative
  if (path === "/api/participants/detail" && req.method === "GET") {
    if (!user) return json(res, 401, { error: "unauthorized" }), true;
    if (!catalog) return json(res, 503, { error: "Case catalog not available" }), true;
    const id = params.get("id") ?? undefined;
    const name = params.get("name") ?? undefined;
    if (!id && !name?.trim()) return json(res, 400, { error: "id or name required" }), true;
    try {
      warmParticipantIndex(catalog);
      const dossier = buildCatalogPersonDossier(catalog, {
        id,
        name: name?.trim(),
        role: params.get("role") ?? undefined,
        caseLimit: Number(params.get("caseLimit") ?? 80),
      });
      return json(res, dossier ? 200 : 404, dossier ? { dossier } : { error: "not found" }), true;
    } catch (e) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e) }), true;
    }
  }

  // GET /api/cases/detail?id=… — single case card
  if (path === "/api/cases/detail" && req.method === "GET") {
    if (!catalog) return json(res, 503, { error: "Case catalog not available" }), true;
    const id = params.get("id");
    if (!id) return json(res, 400, { error: "id required" }), true;
    const c = catalog.get(id);
    return json(res, c ? 200 : 404, c ? { case: c } : { error: "not found" }), true;
  }

  // GET /api/cases/document?caseId=…&docId=… — full act text for viewer
  if (path === "/api/cases/document" && req.method === "GET") {
    if (!user) return json(res, 401, { error: "unauthorized" }), true;
    if (!catalog) return json(res, 503, { error: "Case catalog not available" }), true;
    const caseId = params.get("caseId");
    const docId = params.get("docId");
    if (!caseId || !docId) return json(res, 400, { error: "caseId and docId required" }), true;

    const c = catalog.get(caseId);
    if (!c) return json(res, 404, { error: "case not found" }), true;

    const meta = c.documents.find((d) => d.docId === docId);
    if (!meta) return json(res, 404, { error: "document not found" }), true;

    try {
      const doc = await getCatalogDocument(catalog, rag, sudrf, caseId, docId);
      return json(res, 200, doc), true;
    } catch (e) {
      return json(res, 404, { error: e instanceof Error ? e.message : String(e) }), true;
    }
  }

  // GET /api/cases/courts — courts present in catalog (for filters)
  if (path === "/api/cases/courts" && req.method === "GET") {
    if (!catalog) return json(res, 503, { error: "Case catalog not available" }), true;
    const courts = catalog.courts().filter(
      (c) => !isDisplayRegionScoped() || c.region === DISPLAY_REGION,
    );
    return json(res, 200, { courts }), true;
  }

  // GET /api/cases/categories — categories in catalog (with counts)
  if (path === "/api/cases/categories" && req.method === "GET") {
    if (!catalog) return json(res, 503, { error: "Case catalog not available" }), true;
    return json(res, 200, { categories: catalog.categoryFacets() }), true;
  }

  // GET /api/cases/regions — regions in catalog (with counts)
  if (path === "/api/cases/regions" && req.method === "GET") {
    if (!catalog) return json(res, 503, { error: "Case catalog not available" }), true;
    const regions = catalog.regions().filter(
      (r) => !isDisplayRegionScoped() || r.region === DISPLAY_REGION,
    );
    return json(res, 200, { regions }), true;
  }

  // GET /api/lawyers — FIFA-style participant cards from catalog
  if (path === "/api/lawyers" && req.method === "GET") {
    if (!user) return json(res, 401, { error: "unauthorized" }), true;
    if (!catalog) return json(res, 503, { error: "Case catalog not available" }), true;
    try {
      warmLawyerIndex(catalog);
      const result = listLawyerCards(catalog, {
        q: params.get("q") ?? undefined,
        role: params.get("role") ?? undefined,
        limit: Number(params.get("limit") ?? 48),
        offset: Number(params.get("offset") ?? 0),
      });
      return json(res, 200, result), true;
    } catch (e) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e), indexReady: false, total: 0, lawyers: [] }), true;
    }
  }

  // GET /api/lawyers/heatmap — regional density of lawyer/judge cards
  if (path === "/api/lawyers/heatmap" && req.method === "GET") {
    if (!user) return json(res, 401, { error: "unauthorized" }), true;
    if (!catalog) return json(res, 503, { error: "Case catalog not available" }), true;
    try {
      warmLawyerIndex(catalog);
      const role = params.get("role");
      const r = role === "lawyer" || role === "judge" ? role : undefined;
      const heatmap = lawyerHeatmap(catalog, r);
      return json(res, 200, { ...heatmap, indexReady: isLawyerIndexReady() }), true;
    } catch (e) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e), cells: [], mode: "cases", indexReady: false }), true;
    }
  }

  // GET /api/lawyers/detail?id=… — single lawyer card + all linked cases
  if (path === "/api/lawyers/detail" && req.method === "GET") {
    if (!user) return json(res, 401, { error: "unauthorized" }), true;
    if (!catalog) return json(res, 503, { error: "Case catalog not available" }), true;
    try {
      const id = params.get("id");
      if (!id) return json(res, 400, { error: "id required" }), true;
      warmLawyerIndex(catalog);
      const lawyer = getLawyerCard(catalog, id);
      if (!lawyer && !isLawyerIndexReady()) {
        return json(res, 503, { error: "index building", indexReady: false }), true;
      }
      return json(res, lawyer ? 200 : 404, lawyer ? { lawyer } : { error: "not found" }), true;
    } catch (e) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e) }), true;
    }
  }

  // GET /api/entities/resolve?q=… — normalize and find legal entities in catalog
  if (path === "/api/entities/resolve" && req.method === "GET") {
    if (!catalog) return json(res, 503, { error: "Case catalog not available" }), true;
    const q = new URLSearchParams(url.split("?")[1] ?? "").get("q")?.trim();
    if (!q) return json(res, 400, { error: "q required" }), true;
    const limit = Math.min(Number(new URLSearchParams(url.split("?")[1] ?? "").get("limit") ?? 20), 50);
    return json(res, 200, resolveEntity(catalog, q, limit)), true;
  }

  // GET /api/analytics/coverage — catalog + RAG data quality funnel
  if (path === "/api/analytics/coverage" && req.method === "GET") {
    if (!catalog) return json(res, 503, { error: "Case catalog not available" }), true;
    if (!rag) return json(res, 503, { error: "RAG index not available" }), true;
    const scope = isDisplayRegionScoped() ? DISPLAY_REGION : undefined;
    const cacheKey = scope ?? "all";
    const now = Date.now();
    if (
      coverageCache
      && coverageCache.key === cacheKey
      && coverageCache.size === catalog.size
      && now - coverageCache.at < ANALYTICS_CACHE_MS
    ) {
      return json(res, 200, coverageCache.data), true;
    }
    const coverage = computeCoverage(catalog, rag, { region: scope });
    const collectionRate = computeCollectionRate(catalog, {
      region: scope,
      targetSize: 500_000,
    });
    const payload = { ...coverage, collectionRate };
    coverageCache = { at: now, size: catalog.size, key: cacheKey, data: payload };
    return json(res, 200, payload), true;
  }

  // GET /api/analytics/mordovia — court heatmap + outcomes / depers / winrate
  if (path === "/api/analytics/mordovia" && req.method === "GET") {
    if (!catalog) return json(res, 503, { error: "Case catalog not available" }), true;
    try {
      return json(res, 200, cachedMordoviaDashboard(catalog)), true;
    } catch (e) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e) }), true;
    }
  }

  // POST /api/analytics/insights — A2chatski summary of Mordovia dashboard
  if (path === "/api/analytics/insights" && req.method === "POST") {
    if (!catalog) return json(res, 503, { error: "Case catalog not available" }), true;
    if (!claudeHubConfigured()) {
      return json(res, 503, {
        error: "A2chatski не настроен: задайте CLAUDEHUB_API_KEY в .env и перезапустите сервер",
      }), true;
    }
    try {
      const dashboard = cachedMordoviaDashboard(catalog);
      const insight = await generateMordoviaInsights(dashboard);
      return json(res, 200, insight), true;
    } catch (e) {
      return json(res, 502, { error: e instanceof Error ? e.message : String(e) }), true;
    }
  }

  // POST /api/ai/card — A2chatski on lawyer/judge/participant cards
  if (path === "/api/ai/card" && req.method === "POST") {
    if (!catalog) return json(res, 503, { error: "Case catalog not available" }), true;
    if (!claudeHubConfigured()) {
      return json(res, 503, {
        error: "A2chatski не настроен: задайте CLAUDEHUB_API_KEY в .env и перезапустите сервер",
      }), true;
    }
    try {
      const body = JSON.parse(await readBody(req)) as {
        kind?: string;
        mode?: string;
        id?: string;
        name?: string;
        role?: string;
      };
      const kind = body.kind as CardAiKind | undefined;
      const mode = body.mode as CardAiMode | undefined;
      if (kind !== "lawyer" && kind !== "participant") {
        return json(res, 400, { error: "kind: lawyer | participant" }), true;
      }
      if (mode !== "profile" && mode !== "hints" && mode !== "brief") {
        return json(res, 400, { error: "mode: profile | hints | brief" }), true;
      }

      if (kind === "lawyer") {
        const id = body.id?.trim();
        if (!id) return json(res, 400, { error: "id required" }), true;
        warmLawyerIndex(catalog);
        const lawyer = getLawyerCard(catalog, id);
        if (!lawyer) return json(res, 404, { error: "карточка не найдена" }), true;
        return json(res, 200, await generateCardInsight({ kind, mode, lawyer })), true;
      }

      const id = body.id?.trim();
      const name = body.name?.trim();
      if (!id && !name) return json(res, 400, { error: "id or name required" }), true;
      warmParticipantIndex(catalog);
      const participant = buildCatalogPersonDossier(catalog, {
        id,
        name,
        role: body.role?.trim() || undefined,
        caseLimit: 80,
      });
      if (!participant) return json(res, 404, { error: "досье не найдено" }), true;
      return json(res, 200, await generateCardInsight({ kind, mode, participant })), true;
    } catch (e) {
      return json(res, 502, { error: e instanceof Error ? e.message : String(e) }), true;
    }
  }

  // GET /api/parser/stats — catalog KPIs (+ scheduler fields when auto-parser is on)
  if (path === "/api/parser/stats" && req.method === "GET") {
    if (!catalog) return json(res, 503, { error: "Case catalog not available" }), true;

    const enrich = catalog.enrichmentStats();
    const base = scheduler
      ? serializeParserStats(scheduler.getStats(), tier2Scheduler?.getStats())
      : {
          totalParsed: 0,
          totalFailed: 0,
          totalEnriched: 0,
          totalDocuments: 0,
          catalogSize: catalog.size,
          enrichPending: enrich.pending,
          withDocuments: enrich.withDocuments,
          withActText: enrich.withActText,
          lastUpdate: new Date().toISOString(),
          running: false,
          tasksTotal: 0,
          readyNow: 0,
          tasks: [] as Array<unknown>,
        };

    if (rag && isDisplayRegionScoped()) {
      const cov = computeCoverage(catalog, rag, { region: DISPLAY_REGION });
      const rate = computeCollectionRate(catalog, { region: DISPLAY_REGION, targetSize: 500_000 });
      return json(res, 200, {
        ...base,
        catalogSize: cov.totals.catalogSize,
        enrichPending: cov.totals.enrichPending,
        withDocuments: cov.totals.withDocuments,
        withActText: cov.totals.withActText,
        totalEnriched: cov.totals.enriched,
        inRag: cov.totals.inRag,
        ragCases: cov.totals.ragCases,
        ragChunks: cov.totals.ragChunks,
        displayRegion: DISPLAY_REGION,
        displayRegionLabel: displayRegionLabel(),
        collectionRate: rate,
      }), true;
    }

    const rate = computeCollectionRate(catalog, { targetSize: 500_000 });
    return json(res, 200, { ...base, collectionRate: rate }), true;
  }

  // POST /api/parser/enrich — fetch case cards + documents for pending catalog entries
  if (path === "/api/parser/enrich" && req.method === "POST") {
    if (!scheduler) return json(res, 503, { error: "Parser scheduler not available" }), true;
    const body = JSON.parse(await readBody(req)) as { limit?: number; region?: string };
    const limit = Math.min(Math.max(body.limit ?? 20, 1), 100);
    const region = body.region?.trim() || DISPLAY_REGION;
    const result = await scheduler.triggerEnrich(limit, region);
    return json(res, 200, result), true;
  }

  // POST /api/parser/trigger — manually trigger parsing for a court
  if (path === "/api/parser/trigger" && req.method === "POST") {
    if (!scheduler) return json(res, 503, { error: "Parser scheduler not available" }), true;
    const body = JSON.parse(await readBody(req)) as {
      court?: string;
      daysBack?: number;
      daysForward?: number;
    };
    const court = body.court?.trim();
    if (!court) return json(res, 400, { error: "court required" }), true;
    const daysBack = body.daysBack != null ? Math.min(Math.max(body.daysBack, 0), 730) : undefined;
    const daysForward = body.daysForward != null ? Math.min(Math.max(body.daysForward, 1), 730) : undefined;
    const result = await scheduler.triggerCourt(court, { daysBack, daysForward });
    return json(res, 200, result), true;
  }

  // POST /api/parser/tier2-trigger — Tier-2 extended search (historical cases by entry date)
  if (path === "/api/parser/tier2-trigger" && req.method === "POST") {
    if (!tier2Scheduler) return json(res, 503, { error: "Tier-2 parser not available" }), true;
    const body = JSON.parse(await readBody(req)) as {
      court?: string;
      deloId?: number;
      entryDateFrom?: string;
      entryDateTo?: string;
    };
    const court = body.court?.trim();
    const deloId = body.deloId;
    if (!court || deloId == null) return json(res, 400, { error: "court and deloId required" }), true;
    const filters =
      body.entryDateFrom && body.entryDateTo
        ? { entryDateFrom: body.entryDateFrom, entryDateTo: body.entryDateTo }
        : undefined;
    const result = await tier2Scheduler.triggerSearch(court, deloId, filters);
    return json(res, 200, result), true;
  }

  // POST /api/participant/search — unified participant/lawyer dossier
  if (path === "/api/participant/search" && req.method === "POST") {
    if (!user) return json(res, 401, { error: "unauthorized" }), true;
    if (!rag) return json(res, 503, { error: "RAG not available" }), true;
    const body = JSON.parse(await readBody(req)) as {
      name?: string;
      region?: string;
      courts?: string[];
      deepSearch?: boolean;
      maxCourts?: number;
      deloIds?: number[];
    };
    const name = body.name?.trim();
    if (!name) return json(res, 400, { error: "name required" }), true;
    const input = {
      name,
      region: body.region,
      courts: body.courts,
      deepSearch: body.deepSearch,
      maxCourts: body.maxCourts,
      deloIds: body.deloIds,
    };
    const base = buildParticipantDossier(input, catalog, rag);
    const dossier: Record<string, unknown> = {
      query: base.query,
      summary: base.summary,
      courts: base.courts,
      local: base.local,
      limits: base.limits,
    };
    if (input.deepSearch && participantJobs && sudrf) {
      const job = startParticipantDeepSearch(participantJobs, sudrf, input, base.courtsResolved);
      dossier.deepSearch = {
        jobId: job.id,
        status: job.status,
        message: `Фоновый поиск запущен (${job.progress.total} запросов).`,
      };
    }
    return json(res, 200, dossier), true;
  }

  // GET /api/participant/search?jobId=… — poll deep search job
  if (path === "/api/participant/search" && req.method === "GET") {
    if (!user) return json(res, 401, { error: "unauthorized" }), true;
    if (!participantJobs) return json(res, 503, { error: "Participant search not available" }), true;
    const jobId = params.get("jobId");
    if (!jobId) return json(res, 400, { error: "jobId required" }), true;
    const job = participantJobs.get(jobId);
    if (!job) return json(res, 404, { error: "job not found" }), true;
    return json(res, 200, formatParticipantSearchJob(job)), true;
  }

  // Unknown /api route.
  return json(res, 404, { error: "not found" }), true;
}

export { SESSION_COOKIE };
