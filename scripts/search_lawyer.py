#!/usr/bin/env python3
"""Search lawyer/participant via live MCP REST API."""
import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error
import http.cookiejar

BASE = os.environ.get("API_BASE", "https://a2chatsky.ru")
EMAIL = os.environ.get("TEST_EMAIL", "")
PASSWORD = os.environ.get("TEST_PASSWORD", "")
NAME = os.environ.get("SEARCH_NAME", "Наумов Сергей Геннадьевич")

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def call(path, method="GET", body=None, headers=None, timeout=180):
    h = headers or {}
    data = None
    if body is not None:
        data = body if isinstance(body, bytes) else body.encode("utf-8")
    req = urllib.request.Request(f"{BASE}{path}", data=data, method=method, headers=h)
    try:
        with opener.open(req, timeout=timeout) as res:
            return res.status, json.loads(res.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, {"error": raw[:500]}


def main():
    print(f"Поиск: {NAME}\n")

    st, _ = call("/api/login", "POST", json.dumps({"email": EMAIL, "password": PASSWORD}),
                 {"content-type": "application/json"})
    if st != 200:
        print("Login failed", st)
        sys.exit(1)

    st, keydata = call("/api/keys", "POST", json.dumps({"label": "lawyer-search"}),
                       {"content-type": "application/json"})
    if st != 201:
        print("Key create failed", st, keydata)
        sys.exit(1)
    token = keydata["key"]["token"]
    auth = {"authorization": f"Bearer {token}", "content-type": "application/json"}

    # 1. Resolve courts
    courts = []
    for q in ["Московский городской суд", "Москва"]:
        st, data = call("/rest/resolve_court", "POST", json.dumps({"query": q}), auth)
        best = data.get("best") or data
        print(f"resolve_court({q!r}) -> {best.get('subdomain')} | {best.get('name', '')[:60]}")
        if best.get("subdomain"):
            courts.append(best["subdomain"])
        for c in (data.get("candidates") or [])[:3]:
            if c.get("subdomain") not in courts:
                courts.append(c["subdomain"])

    courts = list(dict.fromkeys(courts))[:6]
    print(f"\nСуды для поиска: {courts}\n")

    # 2. Catalog search (local cases store)
    req = urllib.request.Request(f"{BASE}/api/cases?q={urllib.parse.quote(NAME)}&limit=20")
    with opener.open(req, timeout=60) as r:
        catalog = json.loads(r.read().decode())
    print(f"Каталог дел (parser): {catalog.get('total', 0)} совпадений")
    for c in catalog.get("cases", [])[:5]:
        print(f"  - {c.get('caseNumber')} | {c.get('courtName')} | {c.get('parties', '')[:50]}")

    # 3. RAG search
    st, rag = call("/rest/search_case_texts", "POST",
                   json.dumps({"query": NAME, "limit": 10}), auth, timeout=60)
    hits = rag.get("results") or rag.get("chunks") or []
    print(f"\nRAG по текстам актов: {len(hits)} фрагментов")
    for h in hits[:5]:
        print(f"  - {h.get('caseNumber', '?')} | score={h.get('score', 0):.2f} | {h.get('snippet', '')[:80]}")

    # 4. search_cases per court (Tier 2 — slow)
    categories = [
        (5, "гражданские"),
        (4, "уголовные"),
        (1540006, "адм. правонарушения"),
    ]
    all_results = []
    for court in courts[:3]:
        for delo_id, label in categories:
            print(f"\nsearch_cases {court} / {label}...", flush=True)
            st, data = call("/rest/search_cases", "POST",
                            json.dumps({
                                "court": court,
                                "delo_id": delo_id,
                                "participantName": NAME,
                            }), auth, timeout=300)
            if st != 200:
                print(f"  ERR {st}: {data.get('error', data)}")
                continue
            total = data.get("total", 0)
            print(f"  -> {total} дел")
            for r in data.get("results", [])[:10]:
                all_results.append({**r, "court": data.get("court"), "category": data.get("category")})
                print(f"     {r.get('caseNumber')} | {r.get('plaintiff', '')[:30]} / {r.get('defendant', '')[:30]} | {r.get('status', '')}")

    # 5. Hearing schedule today — cases mentioning name unlikely but check court activity
    for court in ["mosgorsud"]:
        st, sched = call("/rest/get_hearing_schedule", "POST",
                         json.dumps({"court": court, "date": "09.07.2026"}), auth, timeout=60)
        print(f"\nРасписание {court}: count={sched.get('count')} status={sched.get('parseStatus')}")
        for item in sched.get("items", []):
            parties = item.get("parties", "")
            if NAME.split()[0].lower() in parties.lower():
                print(f"  MATCH: {item.get('caseNumber')} | {parties[:60]}")

    print(f"\n{'='*50}")
    print(f"Итого найдено через search_cases: {len(all_results)} дел")
    if all_results:
        print(json.dumps(all_results, ensure_ascii=False, indent=2))
    else:
        print("Дел с участником не найдено в проверенных судах/категориях.")


if __name__ == "__main__":
    main()
