import type { CaseCatalog } from "./cases/store.js";
import type { RagIndex } from "./rag/index.js";

export interface CollectedSearchInput {
  query: string;
  limit?: number;
  region?: string;
  court?: string;
  caseNumber?: string;
  participant?: string;
  judge?: string;
}

export interface CollectedSearchResult {
  query: string;
  catalog: {
    total: number;
    cases: Array<{
      id: string;
      caseNumber: string;
      courtName: string;
      courtSubdomain: string;
      courtRegion?: string;
      category?: string;
      judge?: string;
      status?: string;
      hasActText: boolean;
      documentsCount: number;
      enrichedAt?: string;
    }>;
  };
  texts: {
    total: number;
    corpusSize: number;
    corpusCases: number;
    hits: Array<{
      score: number;
      caseUid: string;
      caseNumber?: string;
      court?: string;
      actType?: string;
      actDate?: string;
      chunkIndex: number;
      text: string;
    }>;
  };
}

/** Unified search over local catalog metadata + indexed act texts (RAG). */
export function searchCollected(
  catalog: CaseCatalog,
  rag: RagIndex,
  input: CollectedSearchInput,
): CollectedSearchResult {
  const q = input.query.trim();
  const limit = Math.min(Math.max(input.limit ?? 15, 1), 50);

  const catalogResult = catalog.list({
    q,
    region: input.region,
    court: input.court,
    participant: input.participant,
    judge: input.judge,
    caseNumber: input.caseNumber,
    limit,
    offset: 0,
  });

  const ragResult = rag.search(q, limit);
  let hits = ragResult.hits;
  if (input.court) {
    hits = hits.filter(
      (h) => h.chunk.court?.toLowerCase().includes(input.court!.toLowerCase()),
    );
  }
  if (input.caseNumber) {
    hits = hits.filter((h) => h.chunk.caseNumber === input.caseNumber);
  }
  if (input.region) {
    hits = hits.filter((h) => {
      const byUid = catalog.get(h.chunk.caseUid);
      if (byUid) return byUid.courtRegion === input.region;
      return catalog.list({ uid: h.chunk.caseUid, limit: 1 }).cases.some(
        (c) => c.courtRegion === input.region,
      );
    });
  }

  return {
    query: q,
    catalog: {
      total: catalogResult.total,
      cases: catalogResult.cases.map((c) => ({
        id: c.id,
        caseNumber: c.caseNumber,
        courtName: c.courtName,
        courtSubdomain: c.courtSubdomain,
        courtRegion: c.courtRegion,
        category: c.category,
        judge: c.judge,
        status: c.status,
        hasActText: c.hasActText,
        documentsCount: c.documentsCount,
        enrichedAt: c.enrichedAt,
      })),
    },
    texts: {
      total: hits.length,
      corpusSize: rag.size,
      corpusCases: rag.caseCount,
      hits: hits.map((h) => ({
        score: Number(h.score.toFixed(4)),
        caseUid: h.chunk.caseUid,
        caseNumber: h.chunk.caseNumber,
        court: h.chunk.court,
        actType: h.chunk.docName,
        actDate: h.chunk.docDate,
        chunkIndex: h.chunk.index,
        text: h.chunk.text,
      })),
    },
  };
}
