// Shared catalog query helpers for MCP, REST, and cabinet API.

import { z } from "zod";
import type { CaseCatalog, StoredCase } from "../cases/store.js";
import type { RagIndex } from "../rag/index.js";
import type { SudrfClient } from "../sudrf/index.js";
import { searchCollected, type CollectedSearchInput } from "../collected-search.js";

export const CatalogListSchema = z.object({
  q: z.string().optional(),
  court: z.string().optional(),
  region: z.string().optional(),
  caseNumber: z.string().optional(),
  uid: z.string().optional(),
  participant: z.string().optional(),
  judge: z.string().optional(),
  category: z.string().optional(),
  hasDocuments: z.boolean().optional(),
  enriched: z.boolean().optional(),
  hearingFrom: z.string().optional().describe("Hearing date from (YYYY-MM-DD or DD.MM.YYYY)"),
  hearingTo: z.string().optional().describe("Hearing date to (YYYY-MM-DD or DD.MM.YYYY)"),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
});

export type CatalogListInput = z.infer<typeof CatalogListSchema>;

export const SearchCollectedSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional(),
  region: z.string().optional(),
  court: z.string().optional(),
  caseNumber: z.string().optional(),
  participant: z.string().optional(),
  judge: z.string().optional(),
});

export const CatalogDocumentSchema = z.object({
  caseId: z.string(),
  docId: z.string(),
});

export function listCatalogCases(catalog: CaseCatalog, input: CatalogListInput) {
  return catalog.list({
    q: input.q,
    court: input.court,
    region: input.region,
    caseNumber: input.caseNumber,
    uid: input.uid,
    participant: input.participant,
    judge: input.judge,
    category: input.category,
    hasDocuments: input.hasDocuments,
    enriched: input.enriched,
    hearingFrom: input.hearingFrom,
    hearingTo: input.hearingTo,
    limit: input.limit ?? 30,
    offset: input.offset ?? 0,
  });
}

export function searchCollectedCatalog(
  catalog: CaseCatalog,
  rag: RagIndex,
  input: CollectedSearchInput,
) {
  return searchCollected(catalog, rag, input);
}

/** Full act text from catalog, live sudrf, or RAG index. */
export async function getCatalogDocument(
  catalog: CaseCatalog,
  rag: RagIndex | undefined,
  sudrf: SudrfClient | undefined,
  caseId: string,
  docId: string,
): Promise<{ document: Record<string, unknown>; case: Pick<StoredCase, "id" | "caseNumber" | "courtSubdomain" | "caseUrl"> }> {
  const c = catalog.get(caseId);
  if (!c) throw new Error("case not found");

  const meta = c.documents.find((d) => d.docId === docId);
  if (!meta) throw new Error("document not found");

  let text = meta.text?.trim() || undefined;
  let source: "catalog" | "sudrf" | "rag" | "file" = "catalog";

  if (!text && sudrf && c.caseUrl) {
    try {
      const details = await sudrf.getCaseDetails(c.courtSubdomain, c.caseUrl);
      const live = details.documents.find((d) => d.docId === docId);
      if (live?.text?.trim()) {
        text = live.text.trim();
        source = "sudrf";
        catalog.enrichFromDetails(caseId, details, c.hasActText);
        catalog.flush();
      }
    } catch {
      /* fall through */
    }
  }

  if (!text && rag) {
    const uid = c.caseUid ?? c.id;
    const fromRag = rag.getDocumentText(uid, docId);
    if (fromRag) {
      text = fromRag;
      source = "rag";
    }
  }

  if (!text && meta.url) {
    return {
      document: {
        ...meta,
        text: null,
        source: "file",
        downloadUrl: meta.url.startsWith("http")
          ? meta.url
          : `https://${c.courtSubdomain}.sudrf.ru${meta.url}`,
      },
      case: { id: c.id, caseNumber: c.caseNumber, courtSubdomain: c.courtSubdomain, caseUrl: c.caseUrl },
    };
  }

  if (!text) throw new Error("document text not available");

  return {
    document: { ...meta, text, source },
    case: { id: c.id, caseNumber: c.caseNumber, courtSubdomain: c.courtSubdomain, caseUrl: c.caseUrl },
  };
}
