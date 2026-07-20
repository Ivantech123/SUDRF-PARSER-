// Integration test for the RAG MCP tool contract (offline). Exercises the
// exact sequence the index_case / search_case_texts / list_indexed_cases /
// remove_case handlers perform, but with the CaseDetails parsed from the
// saved sample instead of fetched live — so no sudrf.ru network access.
//
// Run: npx tsx scripts/test-rag-mcp.ts
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCaseDetails } from "../src/sudrf/case-parser.js";
import { RagIndex } from "../src/rag/index.js";

const sampleHtml = readFileSync(fileURLToPath(new URL("./case_acts_sample.html", import.meta.url)), "utf8");
const ragPath = fileURLToPath(new URL("./.rag-mcp-test.json", import.meta.url));
rmSync(ragPath, { force: true });

const details = parseCaseDetails(sampleHtml, "Октябрьский районный суд г. Саранска", "/modules.php?name=sud_delo&case_id=155820227");

const rag = new RagIndex();

// index_case
const added = rag.addCase(details);
rag.save(ragPath);
console.log("index_case → chunksAdded:", added, "| corpusCases:", rag.caseCount, "| corpusSize:", rag.size);

// list_indexed_cases
const list = rag.listCases();
console.log("list_indexed_cases →", JSON.stringify(list));

// search_case_texts (a few meaning-ish queries)
for (const q of ["срок исковой давности", "коллекторское агентство уступка", "отмена судебного приказа"]) {
  const res = rag.search(q, 3);
  console.log(`\nsearch_case_texts "${q}" → ${res.total} hits`);
  for (const h of res.hits) {
    console.log(`  [${h.score.toFixed(3)}] ${h.chunk.caseNumber} / ${h.chunk.docName} #${h.chunk.index}`);
  }
}

// reload from disk to confirm persistence matches the server restart path
const rag2 = new RagIndex();
rag2.load(ragPath);
const r2 = rag2.search("срок исковой давности", 2);
console.log("\nreload → corpusCases:", rag2.caseCount, "| 'срок исковой давности' hits:", r2.total);

// remove_case
const uid = details.caseUid!;
const removed = rag2.removeCase(uid);
rag2.save(ragPath);
console.log("remove_case → chunksRemoved:", removed, "| corpusCases:", rag2.caseCount, "| corpusSize:", rag2.size);

rmSync(ragPath, { force: true });
console.log("\nRAG MCP contract OK (offline).");
