// HTTP route handlers for the OAuth 2.0 authorization server.
//
// Mounted by src/index.ts alongside /api/* and /mcp when MCP_TRANSPORT=http.
// Routes:
//   GET  /.well-known/oauth-authorization-server  — RFC 8414 metadata
//   GET  /.well-known/oauth-protected-resource    — RFC 9728 metadata
//   POST /register                                 — RFC 7591 DCR
//   GET  /authorize                                — auth-code + PKCE (renders consent)
//   POST /authorize                                — consent submit
//   POST /oauth/token                              — code → token, refresh, revocation
//   POST /oauth/revoke                             — RFC 7009
//
// The consent screen reuses the existing cabinet session cookie: a user must
// already be logged in (via /api/login) to authorize a client. After consent
// we mint an auth code and 302 back to the client's redirect_uri.

import { type IncomingMessage, type ServerResponse } from "node:http";
import type { AuthStore } from "./store.js";
import {
  OAuthStore,
  type OAuthClient,
  verifyPkce,
  ACCESS_TOKEN_PREFIX,
} from "./oauth.js";

const SESSION_COOKIE = "sudrf_session";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c: Buffer) => { data += c.toString("utf8"); });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown, extraHeaders?: Record<string, string>): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    ...extraHeaders,
  });
  res.end(payload);
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers["cookie"] ?? "";
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// application/x-www-form-urlencoded → flat string map.
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

// Pull a param from the query string, then fall back to form body for POST.
function param(query: Record<string, string>, form: Record<string, string>, key: string): string | undefined {
  return query[key] ?? form[key];
}

// Minimal HTML escaper — consent screen is rendered server-side.
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Base public URL of the authorization server (scheme://host), honoring the
// X-Forwarded-* headers set by the reverse proxy. MCP_PUBLIC_URL is the
// canonical source when deployed behind TLS termination (nginx/Caddy).
function issuerBase(req: IncomingMessage): string {
  const publicUrl = process.env.MCP_PUBLIC_URL;
  if (publicUrl) {
    try {
      const u = new URL(publicUrl);
      return `${u.protocol}//${u.host}`;
    } catch {
      // fall through
    }
  }
  const xfProto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0].trim();
  const xfHost = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0].trim();
  const proto = xfProto ?? "http";
  const host = xfHost ?? req.headers.host ?? "localhost";
  return `${proto}://${host}`;
}

// OAuth error redirect per RFC 6749 §4.1.2.1 — back to the client with an
// error code, or a plain JSON error if no valid redirect_uri.
function errorRedirect(res: ServerResponse, redirectUri: string, err: string, description: string, state?: string): void {
  const u = new URL(redirectUri);
  u.searchParams.set("error", err);
  u.searchParams.set("error_description", description);
  if (state) u.searchParams.set("state", state);
  res.writeHead(302, { location: u.toString() });
  res.end();
}

// ── Consent screen (server-rendered HTML, matches the cabinet aesthetic) ──
function renderConsent(req: IncomingMessage, params: {
  clientId: string;
  clientName: string;
  scope: string;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  userEmail: string;
}): string {
  const base = issuerBase(req);
  // Re-pack the authorize params into the consent form so the POST handler
  // gets exactly what it needs without re-reading the session. response_type
  // MUST be included — without it the POST handler rejects with
  // unsupported_response_type and the flow dies right before the code is minted.
  const fields = {
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: "code",
    scope: params.scope,
    state: params.state ?? "",
    code_challenge: params.codeChallenge,
    code_challenge_method: params.codeChallengeMethod,
  };
  const hidden = Object.entries(fields)
    .map(([k, v]) => `      <input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("\n");
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Авторизация · A2chatski</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100dvh; background:#000; color:#fff;
         font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
         display:flex; align-items:center; justify-content:center; padding:24px; }
  .card { width:100%; max-width:460px; border:1px solid rgba(255,255,255,.12);
          background:rgba(255,255,255,.02); padding:32px; }
  h1 { font-size:24px; letter-spacing:.06em; margin:0 0 4px; font-weight:600; }
  .sub { font-size:11px; text-transform:uppercase; letter-spacing:.3em; color:rgba(255,255,255,.4); margin:0 0 24px; }
  .row { font-size:13px; color:rgba(255,255,255,.7); line-height:1.6; margin:0 0 6px; }
  .label { color:rgba(255,255,255,.4); }
  .scope { font-size:12px; color:#fff; background:rgba(255,255,255,.06);
           border:1px solid rgba(255,255,255,.1); padding:8px 10px; margin:16px 0; }
  .actions { display:flex; gap:12px; margin-top:24px; }
  button { flex:1; cursor:pointer; font-family:inherit; font-size:12px;
           text-transform:uppercase; letter-spacing:.2em; padding:14px;
           border:1px solid rgba(255,255,255,.6); background:transparent; color:#fff;
           transition:background .15s, color .15s; }
  button.allow { border-color:#fff; }
  button.allow:hover { background:#fff; color:#000; }
  button.deny { border-color:rgba(255,255,255,.2); color:rgba(255,255,255,.7); }
  button.deny:hover { border-color:rgba(255,80,80,.5); color:#ffb4b4; }
  .user { font-size:11px; color:rgba(255,255,255,.3); margin-top:18px; }
</style>
</head>
<body>
  <form class="card" method="POST" action="${esc(base)}/authorize">
${hidden}
    <h1>A2CHATS<span style="color:rgba(255,255,255,.4)">KI</span></h1>
    <p class="sub">Авторизация MCP-клиента</p>
    <p class="row"><span class="label">Приложение:</span> ${esc(params.clientName)}</p>
    <p class="row"><span class="label">client_id:</span> ${esc(params.clientId)}</p>
    <p class="row"><span class="label">redirect:</span> ${esc(params.redirectUri)}</p>
    <div class="scope">запрашивает доступ: <b>${esc(params.scope)}</b></div>
    <p class="row">Клиент получит OAuth-токен для вызова MCP-эндпоинта
       <code>/mcp</code> от вашего имени. Доступ можно отозвать в кабинете.</p>
    <div class="actions">
      <button class="deny" name="action" value="deny">Отклонить</button>
      <button class="allow" name="action" value="allow">Разрешить</button>
    </div>
    <p class="user">Вы вошли как ${esc(params.userEmail)}</p>
  </form>
</body>
</html>`;
}

// ── Login screen rendered server-side inside /authorize ────────────────────
// The cabinet SPA uses hash routing (#/login), so there is no server path
// /login to redirect to — Caddy would serve index.html and the SPA would show
// the landing page, never returning the user to the consent flow. Instead we
// render a real login form here that POSTs email/password to /api/login and
// then reloads /authorize with the original query string. After a successful
// login the session cookie is set, so the reload hits the consent screen.
function renderAuthorizeLogin(req: IncomingMessage, query: string, error?: string): string {
  const base = issuerBase(req);
  const next = encodeURIComponent(`/authorize${query ? `?${query}` : ""}`);
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Вход · A2chatski</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100dvh; background:#000; color:#fff;
         font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
         display:flex; align-items:center; justify-content:center; padding:24px; }
  .card { width:100%; max-width:380px; border:1px solid rgba(255,255,255,.12);
          background:rgba(255,255,255,.02); padding:32px; }
  h1 { font-size:24px; letter-spacing:.06em; margin:0 0 4px; font-weight:600; }
  .sub { font-size:11px; text-transform:uppercase; letter-spacing:.3em; color:rgba(255,255,255,.4); margin:0 0 24px; }
  label { display:block; font-size:10px; text-transform:uppercase; letter-spacing:.2em; color:rgba(255,255,255,.4); margin:0 0 6px; }
  input { width:100%; border:1px solid rgba(255,255,255,.15); background:#000; color:#fff;
          padding:12px; font-family:inherit; font-size:13px; outline:none; }
  input:focus { border-color:rgba(255,255,255,.6); }
  .field { margin:0 0 16px; }
  button { width:100%; cursor:pointer; font-family:inherit; font-size:11px;
           text-transform:uppercase; letter-spacing:.2em; padding:14px;
           border:1px solid #fff; background:transparent; color:#fff;
           transition:background .15s, color .15s; margin-top:8px; }
  button:hover { background:#fff; color:#000; }
  .err { border:1px solid rgba(255,80,80,.3); background:rgba(255,80,80,.1); color:#ffb4b4;
         padding:10px; font-size:12px; margin:0 0 16px; }
  .note { font-size:11px; color:rgba(255,255,255,.3); margin-top:18px; line-height:1.5; }
</style>
</head>
<body>
  <form class="card" method="POST" action="${esc(base)}/api/login?next=${next}">
    <h1>A2CHATS<span style="color:rgba(255,255,255,.4)">KI</span></h1>
    <p class="sub">Вход в кабинет</p>
    ${error ? `<div class="err">${esc(error)}</div>` : ""}
    <div class="field">
      <label>Эл. почта</label>
      <input type="email" name="email" required autofocus placeholder="you@example.com">
    </div>
    <div class="field">
      <label>Пароль</label>
      <input type="password" name="password" required placeholder="••••••••">
    </div>
    <button type="submit">Войти</button>
    <p class="note">Войдите, чтобы разрешить MCP-клиенту доступ к серверу. После входа вы вернётесь к экрану согласия.</p>
  </form>
</body>
</html>`;
}

// ── Main entry ────────────────────────────────────────────────────────────
// Returns true if the request was an OAuth route (handled), false otherwise.
export async function handleOAuthRoute(
  req: IncomingMessage,
  res: ServerResponse,
  oauth: OAuthStore,
  auth: AuthStore
): Promise<boolean> {
  const url = req.url ?? "";
  const path = url.split("?")[0];
  const base = issuerBase(req);
  const query = Object.fromEntries(new URL(url, base).searchParams);

  // ── CORS preflight ────────────────────────────────────────────────────
  // Claude's connector flow and browser-based clients issue OPTIONS before
  // POST /register and POST /oauth/token. Answer with permissive headers so
  // the actual request follows. (The /mcp endpoint is not browser-CORS-gated
  // because MCP clients call it directly, not via fetch from a web page.)
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-max-age": "86400",
    });
    res.end();
    return true;
  }

  // ── RFC 8414: authorization-server metadata ───────────────────────────
  if (path === "/.well-known/oauth-authorization-server" && req.method === "GET") {
    json(res, 200, {
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/register`,
      revocation_endpoint: `${base}/oauth/revoke`,
      scopes_supported: ["sudrf", "openid", "profile", "email"],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: [
        "client_secret_basic",
        "client_secret_post",
        "none",
      ],
      code_challenge_methods_supported: ["S256"],
      // Claude prefers CIMD when advertised; still supports DCR via /register.
      client_id_metadata_document_supported: true,
      // Explicitly opt out of PAR / request_uri — we don't require them, and
      // some clients fail the flow if these flags are absent.
      require_pushed_authorization_requests: false,
      require_request_uri_registration: false,
      service_documentation: "https://modelcontextprotocol.io/",
    });
    return true;
  }

  // ── RFC 9728: protected-resource metadata (advertises /mcp auth) ───────
  // RFC 9728 §3.1: when the resource URL has a path (/mcp), clients probe
  // /.well-known/oauth-protected-resource/mcp first. Claude fails discovery
  // ("Couldn't register with sudrf's sign-in service") if this 404s.
  const prmPayload = {
    resource: `${base}/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    scopes_supported: ["sudrf", "openid", "profile", "email"],
  };
  if (
    (path === "/.well-known/oauth-protected-resource" ||
      path === "/.well-known/oauth-protected-resource/mcp") &&
    req.method === "GET"
  ) {
    json(res, 200, prmPayload);
    return true;
  }

  // ── JWKS endpoint (empty keys) ────────────────────────────────────────
  // Our access tokens are opaque server-side strings, not JWTs, so there are
  // no signing keys to publish. We still serve a valid empty JWKS so clients
  // that probe it don't get a 404 and abort the flow.
  if (path === "/.well-known/jwks.json" && req.method === "GET") {
    json(res, 200, { keys: [] });
    return true;
  }

  // ── RFC 7591: dynamic client registration ─────────────────────────────
  if (path === "/register" && req.method === "POST") {
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(await readBody(req)); }
    catch { json(res, 400, { error: "invalid_client_metadata", error_description: "invalid JSON" }); return true; }
    const redirectUris = Array.isArray(body.redirect_uris)
      ? body.redirect_uris.filter((u): u is string => typeof u === "string")
      : [];
    if (redirectUris.length === 0) {
      json(res, 400, { error: "invalid_client_metadata", error_description: "redirect_uris required" });
      return true;
    }
    const client = oauth.registerClient({
      redirectUris,
      grantTypes: Array.isArray(body.grant_types) ? (body.grant_types as string[]) : undefined,
      tokenEndpointAuthMethod:
        (body.token_endpoint_auth_method as OAuthClient["tokenEndpointAuthMethod"]) ?? "client_secret_post",
      scope: typeof body.scope === "string" ? body.scope : undefined,
      clientName: typeof body.client_name === "string" ? body.client_name : undefined,
    });
    // RFC 7591 response. client_secret is only returned for confidential
    // clients; public clients (token_endpoint_auth_method=none, PKCE) get no
    // secret. Claude uses a public client.
    const response: Record<string, unknown> = {
      client_id: client.clientId,
      client_id_issued_at: Date.parse(client.createdAt) / 1000,
      redirect_uris: client.redirectUris,
      grant_types: client.grantTypes,
      token_endpoint_auth_method: client.tokenEndpointAuthMethod,
      scope: client.scope,
      client_name: client.clientName,
    };
    if (client.tokenEndpointAuthMethod !== "none") {
      response.client_secret = client.clientSecret;
    }
    json(res, 201, response);
    return true;
  }

  // ── Authorization endpoint (auth-code + PKCE) ─────────────────────────
  if (path === "/authorize") {
    // Session required: the user must be logged into the cabinet to consent.
    const sid = parseCookies(req)[SESSION_COOKIE];
    const user = sid ? auth.getUserBySession(sid) : undefined;

    // For GET we read params from the query; for POST (consent submit) from
    // the form body.
    let form: Record<string, string> = {};
    if (req.method === "POST") {
      const raw = await readBody(req);
      form = parseForm(raw);
    }
    const clientId = param(query, form, "client_id");
    const redirectUri = param(query, form, "redirect_uri");
    const responseType = param(query, form, "response_type");
    const scope = param(query, form, "scope") ?? "sudrf";
    const state = param(query, form, "state");
    const codeChallenge = param(query, form, "code_challenge");
    const codeChallengeMethod = param(query, form, "code_challenge_method");

    const client = clientId ? await oauth.resolveClient(clientId) : undefined;
    const displayName = client
      ? (isCimdClientId(client.clientId) ? new URL(client.clientId).host : client.clientName)
      : "";

    // If something is wrong and we have a valid redirect_uri, send an error
    // there; otherwise a plain JSON error.
    const fail = (err: string, desc: string): void => {
      if (client && redirectUri && oauth.redirectUriAllowed(client, redirectUri)) {
        errorRedirect(res, redirectUri, err, desc, state);
      } else {
        json(res, 400, { error: err, error_description: desc });
      }
    };

    if (!client) { fail("invalid_client", "unknown client_id"); return true; }
    if (responseType !== "code") { fail("unsupported_response_type", "only code is supported"); return true; }
    if (!redirectUri || !oauth.redirectUriAllowed(client, redirectUri)) {
      json(res, 400, { error: "invalid_request", error_description: "invalid redirect_uri" });
      return true;
    }
    if (!codeChallenge || codeChallengeMethod !== "S256") {
      fail("invalid_request", "PKCE S256 required (code_challenge + code_challenge_method=S256)");
      return true;
    }

    // Not logged in → render a server-side login form (the cabinet SPA uses
    // hash routing, so /login is not a real server path). The form POSTs to
    // /api/login?next=<this authorize URL>; after a successful login the API
    // 302-redirects back here with the session cookie set, and we render the
    // consent screen. This keeps the whole OAuth flow on server-rendered pages
    // reachable by Claude Desktop's embedded browser.
    if (!user) {
      const qs = url.split("?")[1] ?? "";
      const errVal = new URL(url, base).searchParams.get("error") ?? undefined;
      const html = renderAuthorizeLogin(req, qs, errVal ?? undefined);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(html);
      return true;
    }

    if (req.method === "GET") {
      // Render the consent screen.
      const html = renderConsent(req, {
        clientId: client.clientId,
        clientName: displayName,
        scope,
        redirectUri,
        state,
        codeChallenge,
        codeChallengeMethod: "S256",
        userEmail: user.email,
      });
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(html);
      return true;
    }

    // POST — consent decision.
    const action = form.action;
    if (action !== "allow") {
      errorRedirect(res, redirectUri, "access_denied", "user denied consent", state);
      return true;
    }
    const code = oauth.createAuthCode({
      clientId: client.clientId,
      userId: user.id,
      redirectUri,
      scope,
      codeChallenge,
      codeChallengeMethod: "S256",
    });
    const out = new URL(redirectUri);
    out.searchParams.set("code", code.code);
    if (state) out.searchParams.set("state", state);
    res.writeHead(302, { location: out.toString() });
    res.end();
    return true;
  }

  // ── Token endpoint ────────────────────────────────────────────────────
  if (path === "/oauth/token" && req.method === "POST") {
    const raw = await readBody(req);
    const form = parseForm(raw);
    const grantType = form.grant_type;

    // Client auth: client_secret_basic (Authorization header) or
    // client_secret_post (body fields). Public clients (PKCE) use "none".
    let clientId = form.client_id;
    let clientSecret = form.client_secret;
    const authHeader = req.headers["authorization"] ?? "";
    const basic = /^Basic\s+(.+)$/i.exec(authHeader);
    if (basic) {
      try {
        const decoded = Buffer.from(basic[1], "base64").toString("utf8");
        const i = decoded.indexOf(":");
        if (i > 0) { clientId = decoded.slice(0, i); clientSecret = decoded.slice(i + 1); }
      } catch { /* malformed basic — fall through */ }
    }
    const client = clientId ? await oauth.resolveClient(clientId) : undefined;

    // ─ authorization_code grant ───────────────────────────────────────
    if (grantType === "authorization_code") {
      if (!client) { json(res, 401, { error: "invalid_client" }); return true; }
      if (client.tokenEndpointAuthMethod !== "none") {
        if (!clientSecret || !oauth.authenticateClient(client.clientId, clientSecret)) {
          json(res, 401, { error: "invalid_client" }); return true;
        }
      }
      const code = oauth.consumeAuthCode(form.code ?? "");
      if (!code) { json(res, 400, { error: "invalid_grant", error_description: "invalid or expired code" }); return true; }
      if (code.clientId !== client.clientId) {
        json(res, 400, { error: "invalid_grant", error_description: "code was issued to another client" });
        return true;
      }
      if (form.redirect_uri && form.redirect_uri !== code.redirectUri) {
        json(res, 400, { error: "invalid_grant", error_description: "redirect_uri mismatch" });
        return true;
      }
      // PKCE check.
      if (!form.code_verifier || !verifyPkce(form.code_verifier, code.codeChallenge)) {
        json(res, 400, { error: "invalid_grant", error_description: "PKCE verification failed" });
        return true;
      }
      const tok = oauth.createAccessToken(client.clientId, code.userId, code.scope);
      json(res, 200, {
        access_token: tok.accessToken,
        token_type: "Bearer",
        expires_in: tok.expiresIn,
        refresh_token: tok.refreshToken,
        scope: code.scope,
      });
      return true;
    }

    // ─ refresh_token grant ─────────────────────────────────────────────
    if (grantType === "refresh_token") {
      if (!client) { json(res, 401, { error: "invalid_client" }); return true; }
      if (client.tokenEndpointAuthMethod !== "none") {
        if (!clientSecret || !oauth.authenticateClient(client.clientId, clientSecret)) {
          json(res, 401, { error: "invalid_client" }); return true;
        }
      }
      const tok = oauth.refreshAccessToken(form.refresh_token ?? "");
      if (!tok) { json(res, 400, { error: "invalid_grant", error_description: "invalid refresh token" }); return true; }
      json(res, 200, {
        access_token: tok.accessToken,
        token_type: "Bearer",
        expires_in: tok.expiresIn,
        refresh_token: tok.refreshToken,
      });
      return true;
    }

    json(res, 400, { error: "unsupported_grant_type" });
    return true;
  }

  // ── RFC 7009 revocation ───────────────────────────────────────────────
  if (path === "/oauth/revoke" && req.method === "POST") {
    const form = parseForm(await readBody(req));
    if (form.token) oauth.revoke(form.token);
    json(res, 200, {});
    return true;
  }

  return false;
}

// Helper exported for index.ts: is this bearer string an OAuth access token
// (prefixed) or a cabinet key? Lets /mcp pick the right validator cheaply.
export function isOAuthToken(token: string): boolean {
  return token.startsWith(ACCESS_TOKEN_PREFIX);
}

function isCimdClientId(clientId: string): boolean {
  try {
    return new URL(clientId).protocol === "https:";
  } catch {
    return false;
  }
}
