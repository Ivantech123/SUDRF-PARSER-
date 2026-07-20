// Apply fetched case-card HTML to catalog + RAG (called by Go parser-worker).

import { parseCaseDetails } from "../sudrf/case-parser.js";
import type { SudrfClient } from "../sudrf/index.js";
import type { RagIndex } from "../rag/index.js";
import type { CaseCatalog } from "../cases/store.js";

export interface EnrichHtmlInput {
  id: string;
  courtSubdomain: string;
  caseUrl: string;
  html: string;
}

export function enrichCaseFromHtml(
  catalog: CaseCatalog,
  rag: RagIndex,
  client: SudrfClient,
  saveRag: () => void,
  input: EnrichHtmlInput,
): { enriched: boolean; documents: number; chunks: number } {
  const existing = catalog.get(input.id);
  if (!existing) {
    throw new Error(`case not found: ${input.id}`);
  }
  if (existing.enrichedAt) {
    return { enriched: false, documents: 0, chunks: 0 };
  }

  const court = client.resolveCourt(input.courtSubdomain);
  const details = parseCaseDetails(input.html, court.name, input.caseUrl);
  const chunks = rag.addCase(details, false);
  catalog.enrichFromDetails(input.id, details, chunks > 0);
  if (chunks > 0) {
    catalog.markHasActText(input.id);
    saveRag();
  }
  catalog.flush();

  return {
    enriched: true,
    documents: details.documents?.length ?? 0,
    chunks,
  };
}
