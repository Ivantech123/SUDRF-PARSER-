// End-to-end RAG test: parse the saved case-with-acts sample, index it,
// run a few meaning-ish queries, and show ranked chunks + persistence round-trip.
import { readFileSync, rmSync, existsSync } from "node:fs";
import { parseCaseDetails } from "../src/sudrf/case-parser.js";
import { RagIndex } from "../src/rag/index.js";

const html = readFileSync(new URL("./case_acts_sample.html", import.meta.url), "utf8");
const details = parseCaseDetails(html, "Октябрьский районный суд г. Саранска", "/modules.php?name=sud_delo&case_id=155820227");

const rag = new RagIndex();
const added = rag.addCase(details);
console.log("case:", details.caseNumber, "| chunks added:", added, "| index size:", rag.size, "| cases:", rag.caseCount);

const queries = [
  "срок исковой давности",
  "коллекторское агентие уступка",
  "мировой судья первой инстанции",
  "апелляционная жалоба",
  "расписка долг",
];

for (const q of queries) {
  console.log("\n=== query:", q, "===");
  const res = rag.search(q, 3);
  console.log("hits:", res.total);
  for (const h of res.hits) {
    console.log(`  [${h.score.toFixed(3)}] ${h.chunk.caseNumber} / ${h.chunk.docName} #${h.chunk.index}`);
    console.log("    ", h.chunk.text.replace(/\s+/g, " ").slice(0, 180));
  }
}

// persistence round-trip
import { fileURLToPath } from "node:url";
const tmp = fileURLToPath(new URL("./.rag-test.json", import.meta.url));
rag.save(tmp);
if (existsSync(tmp)) {
  const rag2 = new RagIndex();
  rag2.load(tmp);
  const r2 = rag2.search("срок исковой давности", 2);
  console.log("\n=== reload from disk: 'срок исковой давности' ===");
  console.log("size:", rag2.size, "cases:", rag2.caseCount, "hits:", r2.total);
  for (const h of r2.hits) console.log(`  [${h.score.toFixed(3)}] #${h.chunk.index}:`, h.chunk.text.replace(/\s+/g, " ").slice(0, 120));
  rmSync(tmp);
  console.log("persistence OK, temp file removed");
} else {
  console.log("\npersistence: file not written");
}
