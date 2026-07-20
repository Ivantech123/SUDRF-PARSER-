// OAuth 2.0 authorization server for the MCP endpoint.
//
// Why this exists: Claude (Claude.ai / Desktop / Code / Cowork) only connects
// to remote MCP servers via OAuth — pasted static bearer tokens and
// ?token=… query params are explicitly rejected by the MCP authorization spec.
// So to let Claude connect to /mcp we run a real (small) authorization server:
//
//   • Dynamic Client Registration (RFC 7591)  — POST /register
//   • Authorization Server Metadata (RFC 8414)— /.well-known/oauth-authorization-server
//   • Protected Resource Metadata (RFC 9728) — /.well-known/oauth-protected-resource
//   • Authorization Code + PKCE S256          — GET/POST /authorize
//   • Token endpoint (code → token, refresh)  — POST /oauth/token
//
// Issued access tokens are accepted by /mcp as `Authorization: Bearer <token>`
// alongside the existing cabinet keys (backward compatible). Tokens are opaque
// strings stored server-side (looked up in a map) — no JWT signing key needed.
//
// Storage: single JSON file (oauth-store.json next to dist/), same pattern as
// AuthStore / RagIndex. Loaded once at startup, saved after each mutation.

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AuthStore } from "./store.js";

// ── Types ─────────────────────────────────────────────────────────────────

export interface OAuthClient {
  clientId: string;
  clientSecret: string;           // stored server-side, returned only at registration
  redirectUris: string[];
  grantTypes: string[];           // e.g. ["authorization_code", "refresh_token"]
  tokenEndpointAuthMethod: "client_secret_post" | "client_secret_basic" | "none";
  scope: string;
  clientName: string;
  createdAt: string;
}

export interface AuthCode {
  code: string;
  clientId: string;
  userId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  expiresAt: string;              // ISO, 10-min TTL
}

export interface OAuthToken {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  userId: string;
  scope: string;
  expiresAt: string;              // ISO, access-token TTL
  createdAt: string;
}

interface StoreShape {
  version: number;
  clients: Record<string, OAuthClient>;
  codes: Record<string, AuthCode>;
  tokens: Record<string, OAuthToken>;        // accessToken → token
  refreshTokens: Record<string, OAuthToken>; // refreshToken → token
}

const AUTH_CODE_TTL_MS = 1000 * 60 * 10;       // 10 min
const ACCESS_TOKEN_TTL_MS = 1000 * 60 * 60;    // 1 hour
const REFRESH_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

// Prefix OAuth tokens so /mcp can pick the right validator without a miss on
// the cabinet-key map. Cabinet keys are 64-char hex (randomToken); OAuth
// access tokens carry this prefix.
export const ACCESS_TOKEN_PREFIX = "oat_";
export const REFRESH_TOKEN_PREFIX = "ort_";

function rand(len: number): string {
  return randomBytes(len).toString("base64url");
}

// PKCE: BASE64URL(SHA256(verifier)) must equal the stored challenge.
export function verifyPkce(verifier: string, challenge: string): boolean {
  const computed = createHash("sha256").update(verifier).digest("base64url");
  if (computed.length !== challenge.length) return false;
  return timingSafeEqual(Buffer.from(computed), Buffer.from(challenge));
}

// Constant-time secret compare. Returns false on length mismatch.
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Loopback redirect-uri match per RFC 8252: http://127.0.0.1 or http://localhost
// on any port is allowed if the registered uri is the loopback base. For
// non-loopback uris, require exact match.
export function redirectUriAllowed(registered: string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  // Loopback flexibility: if the registered uri is a loopback base without a
  // fixed port (or with a different port), accept any port on the same
  // host/path. Claude uses http://localhost:<random>/callback.
  const loopback = /^http:\/\/(127\.0\.0\.1|\[::1\]|localhost)(:\d+)?(\/.*)?$/i;
  if (!loopback.test(requested)) return false;
  const reqUrl = new URL(requested);
  return registered.some((r) => {
    if (!loopback.test(r)) return false;
    try {
      const regUrl = new URL(r);
      // same path + scheme, host within loopback family — port may differ
      return regUrl.pathname === reqUrl.pathname && regUrl.protocol === reqUrl.protocol;
    } catch {
      return false;
    }
  });
}

// ── Store ─────────────────────────────────────────────────────────────────

export class OAuthStore {
  private clients = new Map<string, OAuthClient>();
  private codes = new Map<string, AuthCode>();
  private tokens = new Map<string, OAuthToken>();        // accessToken → token
  private refreshTokens = new Map<string, OAuthToken>(); // refreshToken → token
  private path: string | null = null;
  private dirty = false;

  // ── Dynamic Client Registration (RFC 7591) ──────────────────────────────
  registerClient(input: {
    redirectUris?: string[];
    grantTypes?: string[];
    tokenEndpointAuthMethod?: OAuthClient["tokenEndpointAuthMethod"];
    scope?: string;
    clientName?: string;
  }): OAuthClient {
    const redirectUris = input.redirectUris ?? [];
    const grantTypes = input.grantTypes?.length
      ? input.grantTypes
      : ["authorization_code", "refresh_token"];
    const client: OAuthClient = {
      clientId: rand(16),
      clientSecret: rand(32),
      redirectUris,
      grantTypes,
      tokenEndpointAuthMethod: input.tokenEndpointAuthMethod ?? "client_secret_post",
      scope: input.scope ?? "sudrf",
      clientName: input.clientName ?? "sudrf-mcp client",
      createdAt: new Date().toISOString(),
    };
    this.clients.set(client.clientId, client);
    this.dirty = true;
    this.saveIfPath();
    return client;
  }

  getClient(clientId: string): OAuthClient | undefined {
    return this.clients.get(clientId);
  }

  // Authenticate a confidential client at the token endpoint. Returns the
  // client if the secret matches, undefined otherwise.
  authenticateClient(clientId: string, secret: string): OAuthClient | undefined {
    const client = this.clients.get(clientId);
    if (!client || !client.clientSecret) return undefined;
    return safeEqual(secret, client.clientSecret) ? client : undefined;
  }

  // ── Authorization codes ─────────────────────────────────────────────────
  createAuthCode(params: {
    clientId: string;
    userId: string;
    redirectUri: string;
    scope: string;
    codeChallenge: string;
    codeChallengeMethod: "S256";
  }): AuthCode {
    const now = Date.now();
    const code: AuthCode = {
      code: rand(24),
      clientId: params.clientId,
      userId: params.userId,
      redirectUri: params.redirectUri,
      scope: params.scope,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: params.codeChallengeMethod,
      expiresAt: new Date(now + AUTH_CODE_TTL_MS).toISOString(),
    };
    this.codes.set(code.code, code);
    this.dirty = true;
    this.saveIfPath();
    return code;
  }

  // Consume a code (single-use). Returns the code if valid+not-expired, else
  // undefined. Deletes the code regardless so it can't be replayed.
  consumeAuthCode(code: string): AuthCode | undefined {
    const c = this.codes.get(code);
    this.codes.delete(code);
    if (!c) return undefined;
    if (Date.parse(c.expiresAt) < Date.now()) {
      this.dirty = true;
      this.saveIfPath();
      return undefined;
    }
    this.dirty = true;
    this.saveIfPath();
    return c;
  }

  // ── Tokens ──────────────────────────────────────────────────────────────
  createAccessToken(clientId: string, userId: string, scope: string): {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  } {
    const now = Date.now();
    const token: OAuthToken = {
      accessToken: ACCESS_TOKEN_PREFIX + rand(32),
      refreshToken: REFRESH_TOKEN_PREFIX + rand(32),
      clientId,
      userId,
      scope,
      expiresAt: new Date(now + ACCESS_TOKEN_TTL_MS).toISOString(),
      createdAt: new Date(now).toISOString(),
    };
    this.tokens.set(token.accessToken, token);
    this.refreshTokens.set(token.refreshToken, token);
    this.dirty = true;
    this.saveIfPath();
    return {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    };
  }

  // /mcp auth path: look up an access token. Returns undefined if missing or
  // expired (expired tokens are reaped lazily).
  validateAccessToken(token: string): OAuthToken | undefined {
    const t = this.tokens.get(token);
    if (!t) return undefined;
    if (Date.parse(t.expiresAt) < Date.now()) {
      this.tokens.delete(t.accessToken);
      this.refreshTokens.delete(t.refreshToken);
      this.dirty = true;
      this.saveIfPath();
      return undefined;
    }
    return t;
  }

  // Refresh grant: rotate both tokens, invalidate the old refresh token.
  refreshAccessToken(refreshToken: string): {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  } | undefined {
    const t = this.refreshTokens.get(refreshToken);
    if (!t) return undefined;
    // invalidate the old pair
    this.tokens.delete(t.accessToken);
    this.refreshTokens.delete(t.refreshToken);
    this.dirty = true;
    return this.createAccessToken(t.clientId, t.userId, t.scope);
  }

  // Revoke (RFC 7009): drop the token if present. Accepts access or refresh.
  revoke(token: string): void {
    const a = this.tokens.get(token);
    if (a) {
      this.tokens.delete(a.accessToken);
      this.refreshTokens.delete(a.refreshToken);
      this.dirty = true;
      this.saveIfPath();
      return;
    }
    if (this.refreshTokens.delete(token)) {
      const at = [...this.tokens.values()].find((x) => x.refreshToken === token);
      if (at) this.tokens.delete(at.accessToken);
      this.dirty = true;
      this.saveIfPath();
    }
  }

  redirectUriAllowed(client: OAuthClient, requested: string): boolean {
    return redirectUriAllowed(client.redirectUris, requested);
  }

  // ── Client ID Metadata Document (CIMD) ────────────────────────────────
  // Claude uses client_id=https://claude.ai/oauth/mcp-oauth-client-metadata
  // instead of DCR. Resolve stored clients first, then fetch+validate CIMD.
  async resolveClient(clientId: string): Promise<OAuthClient | undefined> {
    const stored = this.clients.get(clientId);
    if (stored) return stored;
    return fetchCimdClient(clientId);
  }

  // ── Cabinet views: list/revoke by user ──────────────────────────────────
  // A user authorizes clients via /authorize; these let the cabinet show what
  // has access and revoke it without touching the OAuth endpoints directly.

  // Active access tokens for a user (one row per issued token pair). Excludes
  // expired tokens (reaped lazily here so the cabinet stays accurate).
  listTokensForUser(userId: string): Array<{
    accessToken: string;
    clientId: string;
    scope: string;
    createdAt: string;
    expiresAt: string;
  }> {
    const now = Date.now();
    const out: Array<{
      accessToken: string;
      clientId: string;
      scope: string;
      createdAt: string;
      expiresAt: string;
    }> = [];
    for (const t of this.tokens.values()) {
      if (t.userId !== userId) continue;
      if (Date.parse(t.expiresAt) < now) {
        // reap
        this.tokens.delete(t.accessToken);
        this.refreshTokens.delete(t.refreshToken);
        this.dirty = true;
        continue;
      }
      out.push({
        accessToken: t.accessToken,
        clientId: t.clientId,
        scope: t.scope,
        createdAt: t.createdAt,
        expiresAt: t.expiresAt,
      });
    }
    if (this.dirty) this.saveIfPath();
    return out.sort((a, b) => a.createdAt < b.createdAt ? 1 : -1);
  }

  // Clients a user has authorized (deduped by clientId). Pulls from active
  // tokens so revoked clients drop off automatically.
  listClientsForUser(userId: string): Array<OAuthClient> {
    const ids = new Set<string>();
    for (const t of this.tokens.values()) {
      if (t.userId === userId && Date.parse(t.expiresAt) >= Date.now()) ids.add(t.clientId);
    }
    const out: OAuthClient[] = [];
    for (const id of ids) {
      const c = this.clients.get(id);
      if (c) out.push(c);
    }
    return out;
  }

  // Revoke everything a user issued through a client — drops all their token
  // pairs for that clientId. Used by the cabinet "disconnect agent" button.
  revokeClientForUser(userId: string, clientId: string): number {
    let removed = 0;
    for (const t of [...this.tokens.values()]) {
      if (t.userId === userId && t.clientId === clientId) {
        this.tokens.delete(t.accessToken);
        this.refreshTokens.delete(t.refreshToken);
        removed++;
      }
    }
    if (removed > 0) {
      this.dirty = true;
      this.saveIfPath();
    }
    return removed;
  }

  // ── Persistence ─────────────────────────────────────────────────────────
  load(path: string): void {
    this.path = path;
    if (!existsSync(path)) return;
    const data = JSON.parse(readFileSync(path, "utf8")) as StoreShape;
    this.clients.clear();
    this.codes.clear();
    this.tokens.clear();
    this.refreshTokens.clear();
    for (const c of Object.values(data.clients ?? {})) this.clients.set(c.clientId, c);
    for (const c of Object.values(data.codes ?? {})) this.codes.set(c.code, c);
    for (const t of Object.values(data.tokens ?? {})) this.tokens.set(t.accessToken, t);
    for (const t of Object.values(data.refreshTokens ?? {})) this.refreshTokens.set(t.refreshToken, t);
    this.dirty = false;
  }

  setPath(path: string): void {
    this.path = path;
  }

  private saveIfPath(): void {
    if (!this.path) return;
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const payload: StoreShape = {
      version: 1,
      clients: Object.fromEntries(this.clients),
      codes: Object.fromEntries(this.codes),
      tokens: Object.fromEntries(this.tokens),
      refreshTokens: Object.fromEntries(this.refreshTokens),
    };
    writeFileSync(this.path, JSON.stringify(payload, null, 2), "utf8");
    this.dirty = false;
  }

  flush(): void {
    if (this.path && this.dirty) this.saveIfPath();
  }
}

const CIMD_CACHE_TTL_MS = 5 * 60 * 1000;
const cimdCache = new Map<string, { client: OAuthClient; fetchedAt: number }>();

const CIMD_FETCH_HEADERS = {
  accept: "application/json",
  "user-agent":
    "Mozilla/5.0 (compatible; sudrf-mcp/1.0; +https://modelcontextprotocol.io/)",
};

function isCimdClientId(clientId: string): boolean {
  try {
    const u = new URL(clientId);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

// Map CIMD token_endpoint_auth_method to what we enforce at /oauth/token.
// MCP connectors (ChatGPT, Claude) use PKCE; private_key_jwt is declared but
// we don't validate client_assertion JWTs — PKCE is sufficient.
function cimdTokenAuthMethod(
  doc: Record<string, unknown>
): OAuthClient["tokenEndpointAuthMethod"] {
  const m = doc.token_endpoint_auth_method;
  if (m === "none" || m === "private_key_jwt") return "none";
  if (m === "client_secret_basic" || m === "client_secret_post") return m;
  return "none";
}

function clientFromCimdDoc(
  clientIdUrl: string,
  doc: Record<string, unknown>
): OAuthClient | undefined {
  if (doc.client_id !== clientIdUrl) return undefined;

  const redirectUris = Array.isArray(doc.redirect_uris)
    ? doc.redirect_uris.filter((u): u is string => typeof u === "string")
    : [];
  if (redirectUris.length === 0) return undefined;

  return {
    clientId: clientIdUrl,
    clientSecret: "",
    redirectUris,
    grantTypes: Array.isArray(doc.grant_types)
      ? doc.grant_types.filter((g): g is string => typeof g === "string")
      : ["authorization_code", "refresh_token"],
    tokenEndpointAuthMethod: cimdTokenAuthMethod(doc),
    scope: "sudrf",
    clientName:
      typeof doc.client_name === "string"
        ? doc.client_name
        : new URL(clientIdUrl).host,
    createdAt: new Date().toISOString(),
  };
}

// ChatGPT connector CIMD: https://chatgpt.com/oauth/{id}/client.json
// VPS IPs often get 403 from chatgpt.com — synthesize from the URL pattern.
function synthesizeChatGptCimd(clientIdUrl: string): OAuthClient | undefined {
  const m = /^https:\/\/chatgpt\.com\/oauth\/([^/]+)\/client\.json$/.exec(clientIdUrl);
  if (!m) return undefined;
  const connectorId = m[1];
  return {
    clientId: clientIdUrl,
    clientSecret: "",
    redirectUris: [`https://chatgpt.com/connector/oauth/${connectorId}`],
    grantTypes: ["authorization_code", "refresh_token"],
    tokenEndpointAuthMethod: "none",
    scope: "sudrf",
    clientName: "ChatGPT",
    createdAt: new Date().toISOString(),
  };
}

function cacheCimdClient(client: OAuthClient): OAuthClient {
  cimdCache.set(client.clientId, { client, fetchedAt: Date.now() });
  return client;
}

async function fetchCimdClient(clientIdUrl: string): Promise<OAuthClient | undefined> {
  if (!isCimdClientId(clientIdUrl)) return undefined;

  const cached = cimdCache.get(clientIdUrl);
  if (cached && Date.now() - cached.fetchedAt < CIMD_CACHE_TTL_MS) {
    return cached.client;
  }

  try {
    const res = await fetch(clientIdUrl, {
      headers: CIMD_FETCH_HEADERS,
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const doc = (await res.json()) as Record<string, unknown>;
      const client = clientFromCimdDoc(clientIdUrl, doc);
      if (client) return cacheCimdClient(client);
    }
  } catch {
    // fall through to pattern-based fallback
  }

  const fallback = synthesizeChatGptCimd(clientIdUrl);
  return fallback ? cacheCimdClient(fallback) : undefined;
}
