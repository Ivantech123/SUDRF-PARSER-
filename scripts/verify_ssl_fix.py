#!/usr/bin/env python3
"""Verify HTTP/SSL fix for courts that previously failed with fetch failed."""
import json
import os
import sys
import urllib.request
import http.cookiejar

BASE = os.environ.get("API_BASE", "https://a2chatsky.ru")
EMAIL = os.environ.get("TEST_EMAIL", "")
PASSWORD = os.environ.get("TEST_PASSWORD", "")

# Courts that showed 'fetch failed' in pm2 logs (all http:true in registry)
TEST_COURTS = [
    "krasnogvardeysky--adg",
    "maikopsky--adg",
    "bizhbuliaksky--bkr",
    "abzelilovsky--bkr",
    "giaginsky--adg",
    "mosgorsud",
]

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def main():
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

    def call(path, method="GET", body=None, timeout=300):
        data = None
        h = {}
        if body is not None:
            data = json.dumps(body).encode()
            h["content-type"] = "application/json"
        req = urllib.request.Request(f"{BASE}{path}", data=data, method=method, headers=h)
        with opener.open(req, timeout=timeout) as r:
            return json.loads(r.read().decode())

    call("/api/login", "POST", {"email": EMAIL, "password": PASSWORD})
    stats = call("/api/parser/stats")
    print(f"catalog={stats.get('catalogSize')}, schedule deployed, parser running={stats.get('running')}")

    for court in TEST_COURTS:
        print(f"\n{court}...", flush=True)
        try:
            res = call("/api/parser/trigger", "POST", {
                "court": court,
                "daysBack": 7,
                "daysForward": 3,
            })
            print(f"  collected={res.get('collected')}, enriched={res.get('enriched')}, errors={len(res.get('errors', []))}")
            if res.get("errors"):
                print(f"  err: {res['errors'][0][:100]}")
        except Exception as e:
            print(f"  FAILED: {e}")

    stats = call("/api/parser/stats")
    print(f"\nFINAL catalog={stats.get('catalogSize')}, parsed={stats.get('totalParsed')}")


if __name__ == "__main__":
    main()
