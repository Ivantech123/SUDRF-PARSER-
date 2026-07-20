import os
#!/usr/bin/env python
"""Smoke-test the A2chatski MCP endpoint end-to-end over the public domain.

Logs in as the moderator, creates an MCP key, then drives the MCP Streamable
HTTP endpoint: initialize, tools/list, and several tools/call (local + one
live sudrf.ru call). Parses SSE responses and prints results.
"""
import json, urllib.request, urllib.error, http.cookiejar, sys

BASE = "https://a2chatsky.ru"
EMAIL = os.environ.get("TEST_EMAIL", "")
PASSWORD = os.environ.get("TEST_PASSWORD", "")

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def http(url, method="GET", body=None, headers=None, timeout=60):
    data = None
    h = headers or {}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        h["content-type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with opener.open(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")

def mcp_call(token, method, params=None, id=1, timeout=120):
    """POST a JSON-RPC call to /mcp and parse the SSE `data:` line."""
    payload = {"jsonrpc": "2.0", "id": id, "method": method, "params": params or {}}
    status, text = http(f"{BASE}/mcp", method="POST", body=payload,
                        headers={"authorization": f"Bearer {token}",
                                 "accept": "application/json, text/event-stream"},
                        timeout=timeout)
    # parse SSE: lines like "data: {...}"
    for line in text.splitlines():
        if line.startswith("data:"):
            try:
                return status, json.loads(line[5:].strip())
            except json.JSONDecodeError:
                return status, {"_raw": line[5:].strip()}
    return status, {"_raw": text[:500]}

# ── 1. login + create key ────────────────────────────────────────────────
print("=== 1. login as moderator ===")
st, body = http(f"{BASE}/api/login", method="POST",
                body={"email": EMAIL, "password": PASSWORD})
print(f"  login: {st}")
if st != 200:
    print(body); sys.exit(1)

print("=== 2. create MCP key (label: smoke-test) ===")
st, body = http(f"{BASE}/api/keys", method="POST", body={"label": "smoke-test"})
data = json.loads(body)
token = data["key"]["token"]
endpoint = data["mcpEndpoint"]
print(f"  endpoint: {endpoint}")
print(f"  token:    {token[:24]}…")

# ── 3. MCP calls ─────────────────────────────────────────────────────────
print("\n=== 3. initialize ===")
st, r = mcp_call(token, "initialize", {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {"name": "smoke", "version": "0"},
}, id=1)
print(f"  {st}: server={r.get('result',{}).get('serverInfo',{}).get('name')} v{r.get('result',{}).get('serverInfo',{}).get('version')}")

print("\n=== 4. tools/list ===")
st, r = mcp_call(token, "tools/list", {}, id=2)
tools = r.get("result", {}).get("tools", [])
print(f"  {st}: {len(tools)} tools — {[t['name'] for t in tools]}")

def call_tool(name, args, id, timeout=120):
    print(f"\n=== tools/call: {name} {args} ===")
    st, r = mcp_call(token, "tools/call", {"name": name, "arguments": args}, id=id, timeout=timeout)
    res = r.get("result", {})
    content = res.get("content", [])
    txt = content[0].get("text", "") if content else json.dumps(res)
    is_err = res.get("isError", False)
    preview = txt[:600].replace("\n", " ")
    print(f"  {st}{'  ERROR' if is_err else ''}: {preview}{'…' if len(txt)>600 else ''}")
    return txt

# local tools (fast, no network)
call_tool("list_case_categories", {}, 10)
call_tool("resolve_court", {"query": "Москва"}, 11)
call_tool("list_indexed_cases", {}, 12)
call_tool("search_case_texts", {"query": "срок исковой давности", "k": 3}, 13)

# live sudrf.ru call (Tier 1 HTTP — hearing schedule)
call_tool("get_hearing_schedule", {"court": "mosgorsud", "date": "01.07.2026"}, 14, timeout=180)

print("\n=== done — all MCP calls exercised ===")
