#!/usr/bin/env python3
"""Check parser status on VPS."""
import json
import os
import sys
import urllib.request
import http.cookiejar
import paramiko

BASE = os.environ.get("API_BASE", "https://a2chatsky.ru")
HOST = os.environ.get("VPS_HOST", "31.77.148.90")
PASS = os.environ.get("VPS_PASS")
EMAIL = os.environ.get("TEST_EMAIL", "")
PASSWORD = os.environ.get("TEST_PASSWORD", "")
DEPLOY = os.environ.get("VPS_DEPLOY_DIR", "/var/www/sudrf-mcp")

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def api_stats():
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

    def call(path, method="GET", body=None):
        data = None
        h = {}
        if body is not None:
            data = json.dumps(body).encode()
            h["content-type"] = "application/json"
        req = urllib.request.Request(f"{BASE}{path}", data=data, method=method, headers=h)
        with opener.open(req, timeout=60) as r:
            return json.loads(r.read().decode())

    call("/api/login", "POST", {"email": EMAIL, "password": PASSWORD})
    stats = call("/api/parser/stats")
    cases = call("/api/cases")
    return stats, cases


def ssh_logs():
    if not PASS:
        return "(VPS_PASS not set — skipping logs)"
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=PASS, timeout=30, allow_agent=False, look_for_keys=False)
    try:
        lines = []
        cmds = [
            "pm2 status sudrf-mcp",
            f"ls -lh {DEPLOY}/rag-index.json 2>/dev/null || echo 'no rag-index.json'",
            f"wc -c {DEPLOY}/rag-index.json 2>/dev/null || true",
            f"tail -60 {DEPLOY}/logs/out-0.log 2>/dev/null",
            f"tail -15 {DEPLOY}/logs/error-0.log 2>/dev/null",
        ]
        for cmd in cmds:
            stdin, stdout, stderr = c.exec_command(cmd, timeout=60)
            out = stdout.read().decode("utf-8", "replace").strip()
            if out:
                lines.append(f"$ {cmd}\n{out}")
        return "\n\n".join(lines)
    finally:
        c.close()


def main():
    print(f"Parser check: {BASE}\n")

    stats, cases = api_stats()
    print("=== API: /api/parser/stats ===")
    print(f"  parsed:  {stats.get('totalParsed', 0)}")
    print(f"  failed:  {stats.get('totalFailed', 0)}")
    print(f"  courts:  {len(stats.get('tasks', []))}")
    print(f"  updated: {stats.get('lastUpdate', '?')}")

    active = [t for t in stats.get("tasks", []) if t.get("casesParsed", 0) > 0]
    pending = [t for t in stats.get("tasks", []) if t.get("casesFound", 0) > 0 and t.get("casesParsed", 0) == 0]
    print(f"\n  courts with indexed cases: {len(active)}")
    for t in active[:8]:
        print(f"    {t['court']}: found={t.get('casesFound')}, parsed={t.get('casesParsed')}, next={t.get('nextScheduled','')[:19]}")

    print("\n=== API: /api/cases ===")
    print(f"  indexed in RAG: {cases.get('total', 0)}")
    for c in (cases.get("cases") or [])[:5]:
        print(f"    {c.get('caseNumber','?')} — {c.get('court','?')} ({c.get('chunks',0)} chunks)")

    print("\n=== VPS logs ===")
    print(ssh_logs())


if __name__ == "__main__":
    main()
