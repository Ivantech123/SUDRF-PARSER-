#!/usr/bin/env tsx
// Smoke test for REST API endpoints. Requires a running HTTP server and a valid token.
//
// Usage:
//   1. Start the server in http mode:
//      MCP_TRANSPORT=http MCP_PORT=8080 node dist/index.js
//   2. Get a token:
//      - Via cabinet: create an API key at http://localhost:8080/cabinet
//      - Via OAuth: run scripts/smoke_oauth.py
//   3. Run this script:
//      TOKEN=your_token_here npx tsx scripts/test-rest-api.ts

const BASE_URL = process.env.REST_BASE_URL || "http://localhost:8080/rest";
const TOKEN = process.env.TOKEN || process.env.SUDRF_TOKEN;

if (!TOKEN) {
  console.error("Error: TOKEN environment variable is required.");
  console.error("Usage: TOKEN=your_token_here npx tsx scripts/test-rest-api.ts");
  process.exit(1);
}

const headers = {
  "Authorization": `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};

async function callApi(method: string, endpoint: string, body?: unknown): Promise<unknown> {
  const url = `${BASE_URL}/${endpoint}`;
  console.log(`\n→ ${method} ${endpoint}`);
  if (body) console.log("  Body:", JSON.stringify(body, null, 2));

  const opts: RequestInit = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  try {
    const res = await fetch(url, opts);
    const data = await res.json();
    
    if (!res.ok) {
      console.error(`✗ HTTP ${res.status}:`, data);
      return null;
    }
    
    console.log(`✓ HTTP ${res.status}`);
    return data;
  } catch (e) {
    console.error(`✗ Error:`, e instanceof Error ? e.message : String(e));
    return null;
  }
}

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  sudrf-mcp REST API Smoke Test");
  console.log("═══════════════════════════════════════════════════");
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Token: ${TOKEN.substring(0, 16)}...`);

  // 1. List case categories
  console.log("\n[1/9] List case categories");
  const cats = await callApi("GET", "list_case_categories");
  if (cats && Array.isArray(cats)) {
    console.log(`  Found ${cats.length} categories`);
    console.log(`  First: ${JSON.stringify(cats[0], null, 2)}`);
  }

  // 2. Resolve court (POST)
  console.log("\n[2/9] Resolve court (POST)");
  const court = await callApi("POST", "resolve_court", { query: "Москва" });
  if (court && typeof court === "object" && "subdomain" in court) {
    console.log(`  Resolved: ${(court as any).subdomain} - ${(court as any).name}`);
  }

  // 3. Resolve court (GET with query params)
  console.log("\n[3/9] Resolve court (GET with query params)");
  const courtGet = await fetch(`${BASE_URL}/resolve_court?query=Москва`, { headers }).then(r => r.json());
  if (courtGet && typeof courtGet === "object" && "subdomain" in courtGet) {
    console.log(`  Resolved: ${courtGet.subdomain} - ${courtGet.name}`);
  }

  // 4. Get hearing schedule
  console.log("\n[4/9] Get hearing schedule");
  const today = new Date();
  const dateStr = `${String(today.getDate()).padStart(2, "0")}.${String(today.getMonth() + 1).padStart(2, "0")}.${today.getFullYear()}`;
  const schedule = await callApi("POST", "get_hearing_schedule", {
    court: "mosgorsud",
    date: dateStr,
  });
  if (schedule && typeof schedule === "object" && "count" in schedule) {
    console.log(`  Found ${(schedule as any).count} hearings on ${dateStr}`);
    if ((schedule as any).items && (schedule as any).items.length > 0) {
      console.log(`  First: ${JSON.stringify((schedule as any).items[0], null, 2)}`);
    }
  }

  // 5. Search cases
  console.log("\n[5/9] Search cases");
  const cases = await callApi("POST", "search_cases", {
    court: "mosgorsud",
    delo_id: 5, // гражданские дела
    entryDateFrom: "01.01.2024",
    entryDateTo: "31.12.2024",
  });
  if (cases && typeof cases === "object" && "total" in cases) {
    console.log(`  Found ${(cases as any).total} cases`);
    if ((cases as any).results && (cases as any).results.length > 0) {
      const first = (cases as any).results[0];
      console.log(`  First: ${first.caseNumber} - ${first.plaintiff || "?"} vs ${first.defendant || "?"}`);
    }
  }

  // 6. Get case details (if we have a case from search)
  let caseUrl: string | undefined;
  if (cases && typeof cases === "object" && "results" in cases && (cases as any).results.length > 0) {
    caseUrl = (cases as any).results[0].caseUrl;
  }
  
  if (caseUrl) {
    console.log("\n[6/9] Get case details");
    const details = await callApi("POST", "get_case_details", {
      court: "mosgorsud",
      caseUrl,
      includeDocumentText: false, // only metadata for speed
    });
    if (details && typeof details === "object" && "caseNumber" in details) {
      console.log(`  Case: ${(details as any).caseNumber}`);
      console.log(`  Category: ${(details as any).category || "?"}`);
      console.log(`  Events: ${(details as any).events?.length || 0}`);
      console.log(`  Participants: ${(details as any).participants?.length || 0}`);
      console.log(`  Documents: ${(details as any).documents?.length || 0}`);
    }
  } else {
    console.log("\n[6/9] Get case details — SKIP (no case URL from search)");
  }

  // 7. List indexed cases
  console.log("\n[7/9] List indexed cases");
  const indexed = await callApi("GET", "list_indexed_cases");
  if (indexed && typeof indexed === "object" && "caseCount" in indexed) {
    console.log(`  Corpus: ${(indexed as any).corpusSize} chunks, ${(indexed as any).caseCount} cases`);
    if ((indexed as any).cases && (indexed as any).cases.length > 0) {
      console.log(`  First: ${JSON.stringify((indexed as any).cases[0], null, 2)}`);
    }
  }

  // 8. Search case texts (if corpus is not empty)
  if (indexed && typeof indexed === "object" && "caseCount" in indexed && (indexed as any).caseCount > 0) {
    console.log("\n[8/9] Search case texts");
    const textSearch = await callApi("POST", "search_case_texts", {
      query: "срок исковой давности",
      limit: 3,
    });
    if (textSearch && typeof textSearch === "object" && "hits" in textSearch) {
      console.log(`  Found ${(textSearch as any).total} hits`);
      if ((textSearch as any).hits.length > 0) {
        const hit = (textSearch as any).hits[0];
        console.log(`  Top hit (score ${hit.score}):`);
        console.log(`    Case: ${hit.caseNumber} - ${hit.court}`);
        console.log(`    Act: ${hit.actType} (${hit.actDate || "no date"})`);
        console.log(`    Text: ${hit.text.substring(0, 150)}...`);
      }
    }
  } else {
    console.log("\n[8/9] Search case texts — SKIP (corpus is empty)");
  }

  // 9. Index case (if we have a case URL)
  if (caseUrl) {
    console.log("\n[9/9] Index case");
    const indexResult = await callApi("POST", "index_case", {
      court: "mosgorsud",
      caseUrl,
      replace: false,
    });
    if (indexResult && typeof indexResult === "object" && "chunksAdded" in indexResult) {
      console.log(`  Chunks added: ${(indexResult as any).chunksAdded}`);
      console.log(`  Already indexed: ${(indexResult as any).alreadyIndexed}`);
      console.log(`  Corpus now: ${(indexResult as any).corpusSize} chunks, ${(indexResult as any).corpusCases} cases`);
    }
  } else {
    console.log("\n[9/9] Index case — SKIP (no case URL)");
  }

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  REST API Smoke Test Complete");
  console.log("═══════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
