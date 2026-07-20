#!/usr/bin/env npx tsx
/** Rebuild RAG index from act texts already stored in cases-store.json (no re-fetch). */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CaseCatalog } from "../src/cases/store.js";
import { RagIndex } from "../src/rag/index.js";
import type { CaseDetails } from "../src/sudrf/types.js";

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
  try {
    rag.load(ragPath);
  } catch (e) {
    console.warn("RAG load failed, starting fresh:", (e as Error).message);
  }
}

let casesIndexed = 0;
let chunksAdded = 0;
let skipped = 0;
let noText = 0;

catalog.forEach((c) => {
  if (region && c.courtRegion !== region) return;
  const uid = c.caseUid || c.id;
  if (rag.hasCase(uid)) {
    skipped++;
    return;
  }
  const docs = (c.documents ?? []).filter((d) => d.text && d.text.trim().length >= 80);
  if (!docs.length) {
    if (c.hasActText) noText++;
    return;
  }

  const details: CaseDetails = {
    caseNumber: c.caseNumber,
    caseUid: c.caseUid,
    category: c.category,
    court: c.courtName,
    plaintiff: c.plaintiff,
    defendant: c.defendant,
    judge: c.judge,
    status: c.status,
    participants: c.participants ?? [],
    events: c.events ?? [],
    documents: docs.map((d) => ({
      docId: d.docId,
      name: d.name,
      date: d.date,
      caseNumber: d.caseNumber,
      url: d.url,
      text: d.text,
    })),
    caseUrl: c.caseUrl,
  };

  const n = rag.addCase(details, false);
  if (n > 0) {
    casesIndexed++;
    chunksAdded += n;
  }
});

rag.save(ragPath);
console.log(JSON.stringify({
  region,
  casesPath,
  ragPath,
  catalogSize: catalog.size,
  casesIndexed,
  chunksAdded,
  skippedAlreadyInRag: skipped,
  hasActTextButNoStoredText: noText,
  ragCases: rag.caseCount,
  ragChunks: rag.size,
}, null, 2));
