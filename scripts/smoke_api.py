#!/usr/bin/env python3
"""Full API smoke test against live VPS."""
import json
import os
import sys
import urllib.request
import urllib.error
import http.cookiejar

BASE = os.environ.get("API_BASE", "https://a2chatsky.ru")
EMAIL = os.environ.get("TEST_EMAIL", "")
PASSWORD = os.environ.get("TEST_PASSWORD", "")

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def req(path, method="GET", body=None, headers=None, use_cookie=False):
    h = headers or {}
    data = None
    if body is not None:
        data = body if isinstance(body, bytes) else body.encode("utf-8")
    r = urllib.request.Request(f"{BASE}{path}", data=data, method=method, headers=h)
    o = opener if use_cookie else urllib.request.build_opener()
    try:
        with o.open(r, timeout=60) as res:
            raw = res.read().decode("utf-8", "replace")
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = raw[:300]
            return res.status, parsed
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = raw[:300]
        return e.code, parsed


def ok(name, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {name}" + (f" — {detail}" if detail else ""))
    return cond


def main():
    passed = 0
    failed = 0
    token = None

    print(f"API smoke test: {BASE}\n")

    # Public / auth guards
    print("== Public endpoints ==")
    st, data = req("/api/me")
    if ok("GET /api/me (no auth)", st == 401 and data.get("error") == "not authenticated"):
        passed += 1
    else:
        failed += 1

    st, data = req("/rest/list_case_categories")
    if ok("GET /rest/list_case_categories (no auth)", st == 401, f"HTTP {st} {data}"):
        passed += 1
    else:
        failed += 1

    st, data = req("/.well-known/oauth-protected-resource")
    if ok("OAuth protected-resource HTTPS", data.get("resource", "").startswith("https://"), data.get("resource")):
        passed += 1
    else:
        failed += 1

    # Cabinet login
    print("\n== Cabinet /api/* ==")
    st, data = req("/api/login", method="POST",
                    body=json.dumps({"email": EMAIL, "password": PASSWORD}),
                    headers={"content-type": "application/json"}, use_cookie=True)
    if ok("POST /api/login", st == 200 and "user" in data, f"HTTP {st}"):
        passed += 1
    else:
        failed += 1
        print("\nCannot continue without login"); sys.exit(1)

    st, data = req("/api/me", use_cookie=True)
    if ok("GET /api/me (session)", st == 200 and data.get("user", {}).get("email") == EMAIL):
        passed += 1
    else:
        failed += 1

    st, data = req("/api/cases", use_cookie=True)
    if ok("GET /api/cases", st == 200 and "cases" in data, f"total={data.get('total') if isinstance(data, dict) else data}"):
        passed += 1
    else:
        failed += 1

    st, data = req("/api/parser/stats", use_cookie=True)
    if ok("GET /api/parser/stats", st == 200 and "totalParsed" in data, f"parsed={data.get('totalParsed')}"):
        passed += 1
    else:
        failed += 1

    # Create API key for REST tests
    st, data = req("/api/keys", method="POST",
                    body=json.dumps({"label": "smoke-test"}),
                    headers={"content-type": "application/json"}, use_cookie=True)
    if ok("POST /api/keys", st == 201 and data.get("key", {}).get("token"), "key created"):
        passed += 1
        token = data["key"]["token"]
    else:
        failed += 1

    if not token:
        print("\nNo REST token — skipping /rest/*"); sys.exit(1)

    auth = {"authorization": f"Bearer {token}", "content-type": "application/json"}

    print("\n== REST /rest/* ==")
    tests = [
        ("GET list_case_categories", "GET", "/rest/list_case_categories", None),
        ("POST resolve_court", "POST", "/rest/resolve_court", {"query": "Москва"}),
        ("GET list_indexed_cases", "GET", "/rest/list_indexed_cases", None),
        ("POST search_case_texts", "POST", "/rest/search_case_texts", {"query": "исковая давность", "limit": 3}),
        ("POST parser_stats", "POST", "/rest/parser_stats", {}),
        ("POST list_all_cases", "POST", "/rest/list_all_cases", {}),
    ]
    for name, method, path, body in tests:
        st, data = req(path, method=method,
                        body=json.dumps(body) if body is not None else None,
                        headers=auth)
        good = st == 200
        detail = f"HTTP {st}"
        if isinstance(data, dict) and data.get("error"):
            detail += f" {data['error']}"
        elif name.startswith("GET list_case") and isinstance(data, list):
            detail += f" ({len(data)} categories)"
        elif isinstance(data, dict):
            if "total" in data:
                detail += f" total={data['total']}"
            if "subdomain" in data:
                detail += f" court={data['subdomain']}"
            if "totalParsed" in data:
                detail += f" parsed={data['totalParsed']}"
        if ok(name, good, detail):
            passed += 1
        else:
            failed += 1

    # Tier 1 live call (may be slow)
    print("\n== Live sudrf.ru (Tier 1) ==")
    st, data = req("/rest/get_hearing_schedule", method="POST",
                    body=json.dumps({"court": "mosgorsud", "date": "09.07.2026"}),
                    headers=auth)
    if ok("POST get_hearing_schedule", st == 200 and isinstance(data, dict), f"count={data.get('count') if isinstance(data, dict) else data}"):
        passed += 1
    else:
        failed += 1

    print(f"\n{'='*40}")
    print(f"Results: {passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
