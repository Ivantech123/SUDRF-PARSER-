import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CaseCatalog } from "../dist/cases/store.js";
import { RagIndex } from "../dist/rag/index.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const casesPath = process.env.SUDRF_CASES_PATH ?? resolve(root, "cases-store.json");
const ragPath = process.env.SUDRF_RAG_PATH ?? resolve(root, "rag-index.json");
const region = process.env.PARSER_REGION?.trim() || "13";

const catalog = new CaseCatalog();
if (!existsSync(casesPath)) {
  console.error("cases-store not found:", casesPath);
  process.exit(1);
}
catalog.load(casesPath);

const rag = new RagIndex();
if (existsSync(ragPath)) {
  try { rag.load(ragPath); } catch (e) {
    console.warn("RAG load failed, starting fresh:", e.message);
  }
}

let casesIndexed = 0, chunksAdded = 0, skipped = 0, noText = 0;
catalog.forEach((c) => {
  if (region && c.courtRegion !== region) return;
  const uid = c.caseUid || c.id;
  if (rag.hasCase(uid)) { skipped++; return; }
  const docs = (c.documents || []).filter((d) => d.text && d.text.trim());
  if (!docs.length) { noText++; return; }
  const details = {
    caseUid: uid,
    courtCode: c.courtCode,
    courtRegion: c.courtRegion,
    caseNumber: c.caseNumber,
    documents: docs.map((d) => ({
      docId: d.docId, name: d.name, date: d.date, caseNumber: d.caseNumber, url: d.url, text: d.text,
    })),
    caseUrl: c.caseUrl,
  };
  const n = rag.addCase(details, false);
  if (n > 0) { casesIndexed++; chunksAdded += n; }
});

rag.save(ragPath);
console.log(JSON.stringify({
  region, casesPath, ragPath,
  catalogSize: catalog.size,
  casesIndexed, chunksAdded,
  skippedAlreadyInRag: skipped,
  hasActTextButNoStoredText: noText,
  ragCases: rag.caseCount,
  ragChunks: rag.size,
}, null, 2));
