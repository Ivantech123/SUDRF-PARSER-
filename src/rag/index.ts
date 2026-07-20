// RAG facade: index case documents, search the corpus by meaning-ish keyword
// query, return ranked chunks with enough metadata to cite the source case.
//
// Storage layout (single JSON file):
//   { meta: { [chunkId]: Chunk }, index: <Bm25Index.serialize()> }
// The chunk text is kept in `meta` so search results can return the passage;
// the BM25 index holds only term frequencies (rebuilt from meta on load).

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { chunkDocument, type Chunk } from "./chunker.js";
import { tokenize } from "./tokenizer.js";
import { Bm25Index } from "./bm25.js";
import type { CaseDetails } from "../sudrf/types.js";

export interface RagSearchHit {
  chunk: Chunk;
  score: number;
}

export interface RagSearchResult {
  query: string;
  total: number;
  hits: RagSearchHit[];
}

export class RagIndex {
  private bm25 = new Bm25Index();
  private meta = new Map<string, Chunk>();      // chunkId → chunk (incl. text)
  private indexedCases = new Set<string>();      // caseUid → indexed (dedup)

  get size(): number {
    return this.bm25.size;
  }

  get caseCount(): number {
    return this.indexedCases.size;
  }

  // List indexed cases with a chunk count and denormalized display fields
  // (caseNumber/court pulled from the first chunk of each case).
  listCases(): Array<{ caseUid: string; caseNumber?: string; court?: string; chunks: number }> {
    const byUid = new Map<string, { caseNumber?: string; court?: string; chunks: number }>();
    for (const ch of this.meta.values()) {
      const cur = byUid.get(ch.caseUid) ?? { caseNumber: undefined, court: undefined, chunks: 0 };
      cur.chunks++;
      // fill display fields from the first chunk that has them
      if (!cur.caseNumber && ch.caseNumber) cur.caseNumber = ch.caseNumber;
      if (!cur.court && ch.court) cur.court = ch.court;
      byUid.set(ch.caseUid, cur);
    }
    return [...byUid.entries()].map(([caseUid, v]) => ({ caseUid, ...v }));
  }

  // List indexed cases with display metadata from the first chunk of each case.
  listCasesDetailed(): Array<{
    caseUid: string;
    caseNumber?: string;
    court?: string;
    chunks: number;
    docName?: string;
    docDate?: string;
  }> {
    const byUid = new Map<string, {
      caseNumber?: string;
      court?: string;
      chunks: number;
      docName?: string;
      docDate?: string;
    }>();
    for (const ch of this.meta.values()) {
      const cur = byUid.get(ch.caseUid) ?? {
        caseNumber: undefined,
        court: undefined,
        chunks: 0,
        docName: undefined,
        docDate: undefined,
      };
      cur.chunks++;
      if (!cur.caseNumber && ch.caseNumber) cur.caseNumber = ch.caseNumber;
      if (!cur.court && ch.court) cur.court = ch.court;
      if (!cur.docName && ch.docName) cur.docName = ch.docName;
      if (!cur.docDate && ch.docDate) cur.docDate = ch.docDate;
      byUid.set(ch.caseUid, cur);
    }
    return [...byUid.entries()].map(([caseUid, v]) => ({ caseUid, ...v }));
  }

  // Index all published documents of a case. Skips cases already indexed unless
  // `replace` is true (then re-chunks and replaces that case's chunks).
  addCase(details: CaseDetails, replace = false): number {
    const uid = details.caseUid ?? details.caseNumber ?? details.caseUrl ?? "";
    if (!uid) return 0;
    if (this.indexedCases.has(uid) && !replace) return 0;
    if (replace) this.removeCase(uid);

    let added = 0;
    for (const doc of details.documents ?? []) {
      if (!doc.text || doc.text.trim().length < 80) continue;
      const chunks = chunkDocument(doc.text, {
        caseUid: uid,
        caseNumber: details.caseNumber,
        court: details.court,
        docId: doc.docId,
        docName: doc.name,
        docDate: doc.date,
      });
      for (const ch of chunks) {
        const tokens = tokenize(ch.text);
        if (tokens.length < 5) continue;
        this.bm25.add(ch.id, tokens);
        this.meta.set(ch.id, ch);
        added++;
      }
    }
    if (added) {
      this.indexedCases.add(uid);
      this.dirty = true;
    }
    return added;
  }

  // Remove all chunks belonging to a case from both index and meta.
  removeCase(caseUid: string): number {
    if (!this.indexedCases.has(caseUid)) return 0;
    let removed = 0;
    for (const [id, ch] of this.meta) {
      if (ch.caseUid === caseUid) {
        this.bm25.remove(id);
        this.meta.delete(id);
        removed++;
      }
    }
    this.indexedCases.delete(caseUid);
    if (removed) this.dirty = true;
    return removed;
  }

  clear(): void {
    this.bm25.clear();
    this.meta.clear();
    this.indexedCases.clear();
    this.dirty = true;
  }

  hasCase(caseUid: string): boolean {
    return this.indexedCases.has(caseUid);
  }

  /** Reassemble full document text from indexed chunks (fallback when catalog has no text). */
  getDocumentText(caseUid: string, docId: string): string | null {
    const chunks = [...this.meta.values()]
      .filter((ch) => ch.caseUid === caseUid && ch.docId === docId)
      .sort((a, b) => a.index - b.index);
    if (!chunks.length) return null;
    return chunks.map((ch) => ch.text).join("\n\n");
  }

  // Search the corpus. Returns up to `k` chunks ranked by BM25, each with the
  // full chunk text and source metadata for citation.
  search(query: string, k = 10): RagSearchResult {
    const qTokens = tokenize(query);
    const ranked = this.bm25.search(qTokens, k);
    const hits: RagSearchHit[] = ranked
      .map(([id, score]) => {
        const chunk = this.meta.get(id);
        if (!chunk) return null;
        return { chunk, score };
      })
      .filter((h): h is RagSearchHit => h !== null);
    return { query, total: hits.length, hits };
  }

  // ── Persistence ───────────────────────────────────────────────────────
  private dirty = false;

  markDirty(): void {
    this.dirty = true;
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  save(path: string): void {
    const metaObj: Record<string, Chunk> = {};
    for (const [id, ch] of this.meta) metaObj[id] = ch;
    const payload = JSON.stringify({
      version: 2,
      cases: [...this.indexedCases],
      meta: metaObj,
      // v2: index is an object (v1 nested JSON string still loadable)
      index: this.bm25.serialize(),
    });
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, payload, "utf8");
    try {
      renameSync(tmp, path);
    } catch {
      try { unlinkSync(path); } catch { /* ignore */ }
      renameSync(tmp, path);
    }
    this.dirty = false;
  }

  load(path: string): void {
    if (!existsSync(path)) return;
    const data = JSON.parse(readFileSync(path, "utf8")) as {
      version: number;
      cases: string[];
      meta: Record<string, Chunk>;
      index: string | ReturnType<Bm25Index["serialize"]>;
    };
    this.clear();
    for (const uid of data.cases) this.indexedCases.add(uid);
    for (const [id, ch] of Object.entries(data.meta)) this.meta.set(id, ch);
    this.bm25.load(data.index);
    this.dirty = false;
  }
}

export { chunkDocument } from "./chunker.js";
export { tokenize } from "./tokenizer.js";
export { Bm25Index } from "./bm25.js";
