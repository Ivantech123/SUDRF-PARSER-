#!/usr/bin/env python3
"""Progress: coverage + Go worker stats + recent enrich logs."""
import json
import os
import sys
import urllib.request
import http.cookiejar
import paramiko

BASE = os.environ.get("API_BASE", "https://a2chatsky.ru")
HOST = os.environ.get("VPS_HOST", "31.77.148.90")
PASS = os.environ.get("VPS_PASS", "mdSWlQffT0VuegTZ1fpB")
EMAIL = os.environ.get("TEST_EMAIL", "")
PASSWORD = os.environ.get("TEST_PASSWORD", "")

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def api(path, method="GET", body=None):
    data = json.dumps(body).encode() if body else None
    h = {"content-type": "application/json"} if body else {}
    req = urllib.request.Request(f"{BASE}{path}", data=data, method=method, headers=h)
    with op.open(req, timeout=90) as r:
        return json.loads(r.read().decode())


def main():
    api("/api/login", "POST", {"email": EMAIL, "password": PASSWORD})
    stats = api("/api/parser/stats")
    cov = api("/api/analytics/coverage")

    print("=== Каталог и enrich (Node API) ===")
    print(f"  catalogSize:    {stats.get('catalogSize', '?')}")
    print(f"  enrichPending:  {stats.get('enrichPending', '?')}")
    print(f"  withDocuments:  {stats.get('withDocuments', '?')}")
    print(f"  withActText:    {stats.get('withActText', '?')}")
    print(f"  totalEnriched:  {stats.get('totalEnriched', '?')}")
    print(f"  lastUpdate:     {stats.get('lastUpdate', '?')}")

    t2 = stats.get("tier2") or {}
    print("\n=== Tier-2 ===")
    print(f"  running: {t2.get('running')}  searches: {t2.get('totalSearches')}  collected: {t2.get('totalCollected')}  failed: {t2.get('totalFailed')}")
    print(f"  lastCourt: {t2.get('lastCourt')}  region: {t2.get('region')}")

    t = cov.get("totals", {})
    r = cov.get("rates", {})
    print("\n=== Воронка покрытия ===")
    print(f"  карточек:      {t.get('catalogSize')}")
    print(f"  обогащено:     {t.get('enriched')} ({r.get('enrichedPct')}%)")
    print(f"  с актами:      {t.get('withDocuments')} ({r.get('withDocumentsPct')}%)")
    print(f"  полный текст:  {t.get('withFullText')} ({r.get('fullTextPct')}%)")
    print(f"  в RAG:         {t.get('inRag')} ({r.get('inRagPct')}%)")
    print(f"  очередь:       {t.get('enrichPending')}")
    print(f"  RAG:           {t.get('ragCases')} дел, {t.get('ragChunks')} чанков")

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=PASS, timeout=30, allow_agent=False, look_for_keys=False)
    try:
        def run(cmd):
            _, o, _ = c.exec_command(cmd, timeout=60)
            return o.read().decode("utf-8", "replace").strip()

        print("\n=== PM2 ===")
        print(run("pm2 status"))

        print("\n=== Go worker /stats ===")
        print(run("curl -s http://127.0.0.1:8090/stats") or "(no response)")

        print("\n=== Go worker — последние enrich/schedule ===")
        print(run("grep -E '\\[enrich\\]|\\[parser-worker\\]' /root/.pm2/logs/sudrf-parser-worker-out.log 2>/dev/null | tail -25") or "(empty)")

        print("\n=== Go worker — ошибки ===")
        print(run("tail -12 /root/.pm2/logs/sudrf-parser-worker-error.log 2>/dev/null") or "(empty)")

        print("\n=== Node — enrich internal ===")
        print(run("grep -E 'enrich-html|Enrich queue disabled|catalog reloaded' /root/.pm2/logs/sudrf-mcp-out.log 2>/dev/null | tail -12") or "(empty)")
    finally:
        c.close()


if __name__ == "__main__":
    main()
