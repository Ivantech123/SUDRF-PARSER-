#!/usr/bin/env python3
"""Smoke-test ChatGPT-style CIMD OAuth (URL client_id, no DCR).

Verifies that /authorize accepts client_id=https://chatgpt.com/oauth/.../client.json
even when the VPS cannot fetch chatgpt.com (403) — uses URL-pattern fallback.
"""
import json
import sys
import urllib.parse
import urllib.request

BASE = "https://a2chatsky.ru"
CLIENT_ID = "https://chatgpt.com/oauth/30GVY-P9BrOf/client.json"
REDIRECT_URI = "https://chatgpt.com/connector/oauth/30GVY-P9BrOf"
CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"  # verifier=challenge for smoke only

params = {
    "response_type": "code",
    "client_id": CLIENT_ID,
    "redirect_uri": REDIRECT_URI,
    "scope": "openid profile email",
    "state": "chatgpt-smoke",
    "code_challenge": CHALLENGE,
    "code_challenge_method": "S256",
}
url = f"{BASE}/authorize?" + urllib.parse.urlencode(params)
req = urllib.request.Request(url)
with urllib.request.urlopen(req, timeout=30) as r:
    body = r.read().decode("utf-8", "replace")
    print(f"status={r.status} len={len(body)}")
    if '"error":"invalid_client"' in body:
        print("FAIL: still unknown client_id")
        print(body[:300])
        sys.exit(1)
    if "Вход в кабинет" in body or "Авторизация MCP" in body:
        print("OK: authorize accepted ChatGPT CIMD client_id (login/consent HTML)")
    else:
        print("WARN: unexpected body:", body[:200])
        sys.exit(1)

# metadata scopes
with urllib.request.urlopen(f"{BASE}/.well-known/oauth-authorization-server", timeout=15) as r:
    meta = json.loads(r.read())
    scopes = meta.get("scopes_supported", [])
    print(f"scopes_supported={scopes}")
    assert "openid" in scopes, "openid scope missing"

print("done")
