import os
#!/usr/bin/env python
"""Smoke-test the A2chatski MCP OAuth flow end-to-end over the public domain.

Exercises the full authorization-code + PKCE flow that Claude uses:
  1. login as the moderator (cookie session)
  2. RFC 7591 dynamic client registration (POST /register)
  3. RFC 8414 authorization-server metadata (GET /.well-known/...)
  4. authorize (GET /authorize → consent screen; POST /authorize → code)
  5. token exchange (POST /oauth/token with PKCE verifier → access token)
  6. /mcp tools/list with the OAuth access token
  7. refresh_token grant
  8. revocation

Run: python scripts/smoke_oauth.py
"""
import json, urllib.request, urllib.error, http.cookiejar, sys, base64, hashlib, secrets
import urllib.parse
from urllib.parse import urlparse, parse_qs

BASE = "https://a2chatsky.ru"
EMAIL = os.environ.get("TEST_EMAIL", "")
PASSWORD = os.environ.get("TEST_PASSWORD", "")

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(cj),
    urllib.request.HTTPRedirectHandler(),  # we handle redirects manually below
)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # don't follow — we want to read the Location

opener_noredir = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(cj), NoRedirect(),
)

def http(url, method="GET", body=None, headers=None, timeout=60, follow=True):
    data = None
    h = headers or {}
    if body is not None:
        data = body if isinstance(body, bytes) else body.encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    o = opener if follow else opener_noredir
    try:
        with o.open(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace"), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace"), dict(e.headers)

def form_encode(d):
    return "&".join(f"{k}={urllib.parse.quote(str(v))}" for k, v in d.items())

# ── 1. login (cookie session) ─────────────────────────────────────────────
print("=== 1. login as moderator ===")
st, body, _ = http(f"{BASE}/api/login", method="POST",
                   body=json.dumps({"email": EMAIL, "password": PASSWORD}),
                   headers={"content-type": "application/json"})
print(f"  login: {st}")
if st != 200:
    print(body); sys.exit(1)

# ── 2. authorization-server metadata ──────────────────────────────────────
print("\n=== 2. /.well-known/oauth-authorization-server ===")
st, body, _ = http(f"{BASE}/.well-known/oauth-authorization-server")
meta = json.loads(body)
print(f"  {st}: issuer={meta.get('issuer')}")
print(f"  authorize={meta.get('authorization_endpoint')}")
print(f"  token={meta.get('token_endpoint')}")
print(f"  register={meta.get('registration_endpoint')}")
assert meta["code_challenge_methods_supported"] == ["S256"], "S256 required"

# ── 3. dynamic client registration (RFC 7591) ─────────────────────────────
print("\n=== 3. POST /register (DCR) ===")
REDIRECT_URI = "http://127.0.0.1:8765/callback"
st, body, _ = http(f"{BASE}/register", method="POST",
                   body=json.dumps({
                       "redirect_uris": [REDIRECT_URI],
                       "grant_types": ["authorization_code", "refresh_token"],
                       "token_endpoint_auth_method": "client_secret_post",
                       "scope": "sudrf",
                       "client_name": "smoke-test",
                   }),
                   headers={"content-type": "application/json"})
client = json.loads(body)
print(f"  {st}: client_id={client.get('client_id')[:16]}…")
assert st == 201, f"register failed: {body}"
CLIENT_ID = client["client_id"]
CLIENT_SECRET = client["client_secret"]

# ── 4. authorize: PKCE + consent ──────────────────────────────────────────
print("\n=== 4. GET /authorize (PKCE) ===")
verifier = secrets.token_urlsafe(48)
challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
state = secrets.token_urlsafe(16)

params = {
    "response_type": "code",
    "client_id": CLIENT_ID,
    "redirect_uri": REDIRECT_URI,
    "scope": "sudrf",
    "state": state,
    "code_challenge": challenge,
    "code_challenge_method": "S256",
}
st, body, hdrs = http(f"{BASE}/authorize?" + urllib.parse.urlencode(params), follow=False)
print(f"  {st}: consent screen rendered ({len(body)} bytes)")
assert st == 200 and "<form" in body, "consent screen not rendered"

# Submit consent (POST /authorize, action=allow). Expect 302 → redirect_uri?code=…
print("\n=== 5. POST /authorize (consent=allow) ===")
form = dict(params)
form["action"] = "allow"
st, body, hdrs = http(f"{BASE}/authorize", method="POST",
                      body=form_encode(form),
                      headers={"content-type": "application/x-www-form-urlencoded"},
                      follow=False)
location = hdrs.get("Location") or hdrs.get("location")
print(f"  {st}: location={location[:80] if location else None}…")
assert st in (302, 303) and location, "no redirect after consent"
q = parse_qs(urlparse(location).query)
assert q.get("state", [None])[0] == state, "state mismatch"
CODE = q["code"][0]
print(f"  code={CODE[:16]}…")

# ── 6. token exchange ─────────────────────────────────────────────────────
print("\n=== 6. POST /oauth/token (authorization_code + PKCE) ===")
st, body, _ = http(f"{BASE}/oauth/token", method="POST",
                   body=form_encode({
                       "grant_type": "authorization_code",
                       "code": CODE,
                       "redirect_uri": REDIRECT_URI,
                       "client_id": CLIENT_ID,
                       "client_secret": CLIENT_SECRET,
                       "code_verifier": verifier,
                   }),
                   headers={"content-type": "application/x-www-form-urlencoded"})
tok = json.loads(body)
print(f"  {st}: token_type={tok.get('token_type')} expires_in={tok.get('expires_in')}")
if st != 200:
    print(body); sys.exit(1)
ACCESS_TOKEN = tok["access_token"]
REFRESH_TOKEN = tok["refresh_token"]
print(f"  access_token={ACCESS_TOKEN[:20]}…")

# ── 7. /mcp with OAuth access token ───────────────────────────────────────
print("\n=== 7. /mcp initialize with OAuth token ===")
payload = {"jsonrpc": "2.0", "id": 1, "method": "initialize",
           "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                      "clientInfo": {"name": "smoke-oauth", "version": "0"}}}
st, body, _ = http(f"{BASE}/mcp", method="POST", body=json.dumps(payload),
                   headers={"authorization": f"Bearer {ACCESS_TOKEN}",
                            "accept": "application/json, text/event-stream",
                            "content-type": "application/json"})
for line in body.splitlines():
    if line.startswith("data:"):
        r = json.loads(line[5:].strip())
        si = r.get("result", {}).get("serverInfo", {})
        print(f"  {st}: server={si.get('name')} v{si.get('version')}")
        break
else:
    print(f"  {st}: {body[:200]}")

print("\n=== 8. /mcp tools/list with OAuth token ===")
payload = {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}
st, body, _ = http(f"{BASE}/mcp", method="POST", body=json.dumps(payload),
                   headers={"authorization": f"Bearer {ACCESS_TOKEN}",
                            "accept": "application/json, text/event-stream",
                            "content-type": "application/json"})
for line in body.splitlines():
    if line.startswith("data:"):
        r = json.loads(line[5:].strip())
        tools = r.get("result", {}).get("tools", [])
        print(f"  {st}: {len(tools)} tools — {[t['name'] for t in tools]}")
        break

# ── 9. refresh token ──────────────────────────────────────────────────────
print("\n=== 9. POST /oauth/token (refresh_token) ===")
st, body, _ = http(f"{BASE}/oauth/token", method="POST",
                   body=form_encode({
                       "grant_type": "refresh_token",
                       "refresh_token": REFRESH_TOKEN,
                       "client_id": CLIENT_ID,
                       "client_secret": CLIENT_SECRET,
                   }),
                   headers={"content-type": "application/x-www-form-urlencoded"})
rtok = json.loads(body)
print(f"  {st}: new access_token={rtok.get('access_token','')[:20]}…")
assert st == 200, f"refresh failed: {body}"

# ── 10. revoke ────────────────────────────────────────────────────────────
print("\n=== 10. POST /oauth/revoke ===")
st, body, _ = http(f"{BASE}/oauth/revoke", method="POST",
                   body=form_encode({"token": ACCESS_TOKEN}),
                   headers={"content-type": "application/x-www-form-urlencoded"})
print(f"  {st}: revoked")

# After revocation the token must be rejected.
print("\n=== 11. /mcp after revoke (expect 401) ===")
st, body, _ = http(f"{BASE}/mcp", method="POST", body=json.dumps(payload),
                   headers={"authorization": f"Bearer {ACCESS_TOKEN}",
                            "content-type": "application/json"})
print(f"  {st}: {'OK — rejected' if st == 401 else 'FAIL — still accepted'}")

print("\n=== done — full OAuth + MCP flow exercised ===")
