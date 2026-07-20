# sudrf-parser-worker

Go worker for **Tier-1** hearing schedule collection. Runs alongside Node `sudrf-mcp`:

- **Go**: fast HTTP schedule fetch, concurrent courts, writes `cases-store.json`
- **Node**: enrich, Tier-2 (Playwright), MCP, RAG, web UI

## Build

```bash
# export courts registry (once, after courts.ts changes)
npx tsx scripts/export_courts_json.ts

cd parser-worker
go mod tidy
go build -o sudrf-parser-worker .
```

Linux binary from Windows:

```bash
cd parser-worker
set GOOS=linux
set GOARCH=amd64
go build -o sudrf-parser-worker .
```

## Env

| Variable | Default | Description |
|----------|---------|-------------|
| `PARSER_WORKER_ADDR` | `:8090` | HTTP listen |
| `SUDRF_CASES_PATH` | `./cases-store.json` | Shared catalog (same as Node) |
| `COURTS_REGISTRY_PATH` | `./data/courts-registry.json` | Courts list |
| `PARSER_REGION` | — | Optional federal subject code filter |
| `PARSER_CONCURRENT_COURTS` | `5` | Parallel schedule fetches |
| `PARSER_SCHEDULE_DAYS` | `7` | Days forward |
| `PARSER_TICK_INTERVAL_SEC` | `45` | Loop interval |

## HTTP API

- `GET /health`
- `GET /stats`
- `POST /trigger?court=<subdomain>`

## Node integration

Set on `sudrf-mcp`:

```
PARSER_WORKER_URL=http://127.0.0.1:8090
```

Node disables Tier-1 schedule collection but keeps **enrich** and **Tier-2**. Catalog reloads from disk every 30s.

---

**Author:** Andreev Ivan · [https://t.me/IBlog_Ivan](https://t.me/IBlog_Ivan)
