#!/bin/bash
# Quick REST API smoke test using curl
# Usage: TOKEN=your_token ./scripts/test-rest-api.sh

BASE_URL="${REST_BASE_URL:-http://localhost:8080/rest}"
TOKEN="${TOKEN:-$SUDRF_TOKEN}"

if [ -z "$TOKEN" ]; then
  echo "Error: TOKEN environment variable is required."
  echo "Usage: TOKEN=your_token ./scripts/test-rest-api.sh"
  exit 1
fi

echo "═══════════════════════════════════════════════════"
echo "  sudrf-mcp REST API Quick Test"
echo "═══════════════════════════════════════════════════"
echo "Base URL: $BASE_URL"
echo "Token: ${TOKEN:0:16}..."
echo ""

# Helper function
call_api() {
  local method=$1
  local endpoint=$2
  local data=$3
  
  echo "→ $method /$endpoint"
  
  if [ "$method" = "GET" ]; then
    curl -s -H "Authorization: Bearer $TOKEN" "$BASE_URL/$endpoint" | jq -C . || echo "Error or no jq"
  else
    curl -s -X POST \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "$data" \
      "$BASE_URL/$endpoint" | jq -C . || echo "Error or no jq"
  fi
  echo ""
}

# 1. List categories
echo "[1] List case categories"
call_api GET "list_case_categories"

# 2. Resolve court
echo "[2] Resolve court"
call_api POST "resolve_court" '{"query":"Москва"}'

# 3. Get hearing schedule
echo "[3] Get hearing schedule"
TODAY=$(date +%d.%m.%Y)
call_api POST "get_hearing_schedule" "{\"court\":\"mosgorsud\",\"date\":\"$TODAY\"}"

# 4. List indexed cases
echo "[4] List indexed cases"
call_api GET "list_indexed_cases"

echo "═══════════════════════════════════════════════════"
echo "  Quick Test Complete"
echo "═══════════════════════════════════════════════════"
