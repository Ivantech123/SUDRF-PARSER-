// Catalog + RAG coverage analytics — data quality funnel for the UI and MCP.

import type { CaseCatalog } from "../cases/store.js";
import type { RagIndex } from "../rag/index.js";
import { isDepersonalizedMarker } from "./person-name.js";
import { isRepresentativeRole } from "./depersonalization.js";

export interface RegionCoverage {
  region: string;
  total: number;
  enriched: number;
  withDocuments: number;
  withActText: number;
  inRag: number;
  enrichPending: number;
}

export interface CourtCoverage {
  subdomain: string;
  name: string;
  region?: string;
  total: number;
  enriched: number;
  withDocuments: number;
  withActText: number;
  inRag: number;
}

export interface CoverageStats {
  totals: {
    catalogSize: number;
    withCaseUrl: number;
    enriched: number;
    withDocuments: number;
    withActText: number;
    withFullText: number;
    enrichPending: number;
    inRag: number;
    ragChunks: number;
    ragCases: number;
    /** Representative-role appearances with stop-dictionary / ФИОN markers. */
    depersonalizedRepresentatives: number;
  };
  rates: {
    enrichedPct: number;
    withDocumentsPct: number;
    withActTextPct: number;
    inRagPct: number;
    fullTextPct: number;
  };
  funnel: Array<{ stage: string; label: string; count: number; pct: number }>;
  byRegion: RegionCoverage[];
  byCourt: CourtCoverage[];
  generatedAt: string;
}

function pct(n: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((n / total) * 1000) / 10;
}

function hasFullText(c: {
  hasActText: boolean;
  documents: Array<{ text?: string; hasText?: boolean }>;
}): boolean {
  if (c.hasActText) return true;
  return c.documents.some((d) => d.hasText || (d.text && d.text.trim().length > 50));
}

function inRagSet(
  c: { id: string; caseUid?: string },
  ragUids: Set<string>,
): boolean {
  if (c.caseUid && ragUids.has(c.caseUid)) return true;
  return ragUids.has(c.id);
}

export function computeCoverage(catalog: CaseCatalog, rag: RagIndex, opts?: { region?: string }): CoverageStats {
  const scopeRegion = opts?.region?.trim();
  const ragUids = new Set(rag.listCases().map((r) => r.caseUid));
  const enrich = catalog.enrichmentStats();

  let withCaseUrl = 0;
  let enriched = 0;
  let withDocuments = 0;
  let withActText = 0;
  let withFullText = 0;
  let inRag = 0;

  const regionMap = new Map<string, RegionCoverage>();
  const courtMap = new Map<string, CourtCoverage>();

  const bumpRegion = (region: string, patch: Partial<RegionCoverage>) => {
    const key = region || "—";
    const cur = regionMap.get(key) ?? {
      region: key,
      total: 0,
      enriched: 0,
      withDocuments: 0,
      withActText: 0,
      inRag: 0,
      enrichPending: 0,
    };
    if (patch.total) cur.total += patch.total;
    if (patch.enriched) cur.enriched += patch.enriched;
    if (patch.withDocuments) cur.withDocuments += patch.withDocuments;
    if (patch.withActText) cur.withActText += patch.withActText;
    if (patch.inRag) cur.inRag += patch.inRag;
    if (patch.enrichPending) cur.enrichPending += patch.enrichPending;
    regionMap.set(key, cur);
  };

  const bumpCourt = (
    subdomain: string,
    name: string,
    region: string | undefined,
    patch: Partial<CourtCoverage>,
  ) => {
    const cur = courtMap.get(subdomain) ?? {
      subdomain,
      name,
      region,
      total: 0,
      enriched: 0,
      withDocuments: 0,
      withActText: 0,
      inRag: 0,
    };
    if (patch.total) cur.total += patch.total;
    if (patch.enriched) cur.enriched += patch.enriched;
    if (patch.withDocuments) cur.withDocuments += patch.withDocuments;
    if (patch.withActText) cur.withActText += patch.withActText;
    if (patch.inRag) cur.inRag += patch.inRag;
    courtMap.set(subdomain, cur);
  };

  let scopedCount = 0;
  let scopedPending = 0;
  let depersonalizedRepresentatives = 0;

  catalog.forEach((c) => {
    if (scopeRegion && c.courtRegion !== scopeRegion) return;
    scopedCount++;
    const region = c.courtRegion ?? "—";
    const docs = c.documentsCount > 0 || c.documents.length > 0;
    const full = hasFullText(c);
    const ragHit = inRagSet(c, ragUids);
    const pending = Boolean(c.caseUrl && !c.enrichedAt);
    if (pending) scopedPending++;

    for (const p of c.participants ?? []) {
      if (!isRepresentativeRole(p.role)) continue;
      if (isDepersonalizedMarker(p.name)) depersonalizedRepresentatives++;
    }

    const bump = {
      total: 1,
      enriched: c.enrichedAt ? 1 : 0,
      withDocuments: docs ? 1 : 0,
      withActText: c.hasActText ? 1 : 0,
      inRag: ragHit ? 1 : 0,
      enrichPending: pending ? 1 : 0,
    };

    bumpRegion(region, bump);
    bumpCourt(c.courtSubdomain, c.courtName, c.courtRegion, bump);

    if (c.caseUrl) withCaseUrl++;
    if (c.enrichedAt) enriched++;
    if (docs) withDocuments++;
    if (c.hasActText) withActText++;
    if (full) withFullText++;
    if (ragHit) inRag++;
  });

  const catalogSize = scopeRegion ? scopedCount : catalog.size;
  const rates = {
    enrichedPct: pct(enriched, catalogSize),
    withDocumentsPct: pct(withDocuments, catalogSize),
    withActTextPct: pct(withActText, catalogSize),
    inRagPct: pct(inRag, catalogSize),
    fullTextPct: pct(withFullText, catalogSize),
  };

  const funnel = [
    { stage: "catalog", label: "Карточки в каталоге", count: catalogSize, pct: 100 },
    { stage: "caseUrl", label: "Со ссылкой на ГАС", count: withCaseUrl, pct: pct(withCaseUrl, catalogSize) },
    { stage: "enriched", label: "Обогащённые карточки", count: enriched, pct: rates.enrichedPct },
    { stage: "documents", label: "С судебными актами", count: withDocuments, pct: rates.withDocumentsPct },
    { stage: "fullText", label: "С полным текстом", count: withFullText, pct: rates.fullTextPct },
    { stage: "rag", label: "В RAG-индексе", count: inRag, pct: rates.inRagPct },
  ];

  const byRegion = [...regionMap.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 30);

  const byCourt = [...courtMap.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 40);

  return {
    totals: {
      catalogSize,
      withCaseUrl,
      enriched,
      withDocuments,
      withActText,
      withFullText,
      enrichPending: scopeRegion ? scopedPending : enrich.pending,
      inRag,
      ragChunks: rag.size,
      ragCases: rag.caseCount,
      depersonalizedRepresentatives,
    },
    rates,
    funnel,
    byRegion,
    byCourt,
    generatedAt: new Date().toISOString(),
  };
}
