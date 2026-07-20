#!/usr/bin/env python3
"""Trigger document enrichment queue on VPS."""
import json
import os
import sys
import urllib.request
import http.cookiejar

BASE = os.environ.get("API_BASE", "https://a2chatsky.ru")
EMAIL = os.environ.get("TEST_EMAIL", "")
PASSWORD = os.environ.get("TEST_PASSWORD", "")
LIMIT = int(os.environ.get("ENRICH_LIMIT", "50"))

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def main():
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

    def call(path, method="GET", body=None):
        data = None
        h = {}
        if body is not None:
            data = json.dumps(body).encode()
            h["content-type"] = "application/json"
        req = urllib.request.Request(f"{BASE}{path}", data=data, method=method, headers=h)
        with opener.open(req, timeout=600) as r:
            return json.loads(r.read().decode())

    call("/api/login", "POST", {"email": EMAIL, "password": PASSWORD})
    before = call("/api/parser/stats")
    print(f"Before: pending={before.get('enrichPending')}, withDocs={before.get('withDocuments')}, enriched={before.get('totalEnriched')}")

    print(f"\nEnriching up to {LIMIT} cases...")
    res = call("/api/parser/enrich", "POST", {"limit": LIMIT})
    print(f"  enriched={res.get('enriched')}, documents={res.get('documents')}")
    if res.get("errors"):
        for e in res["errors"][:5]:
            print(f"  err: {e[:100]}")

    after = call("/api/parser/stats")
    print(f"\nAfter: pending={after.get('enrichPending')}, withDocs={after.get('withDocuments')}, enriched={after.get('totalEnriched')}")


if __name__ == "__main__":
    main()
