/**
 * Shared MCP/REST helpers for lawyer cards, participant dossiers,
 * Mordovia analytics, and representatives summary.
 */

import { z } from "zod";
import type { CaseCatalog } from "../cases/store.js";
import {
  listLawyerCards,
  getLawyerCard,
  ensureLawyerIndexBuild,
  isLawyerIndexReady,
} from "../lawyers/aggregate.js";
import {
  buildParticipantDossier,
  warmParticipantIndex,
} from "../participants/aggregate.js";
import { buildMordoviaDashboard, type MordoviaDashboard } from "../analytics/region-dashboard.js";
import { buildRepHeatmapsFromCatalog } from "../analytics/rep-heatmap.js";

export const ListLawyersSchema = z.object({
  q: z.string().optional(),
  role: z.enum(["lawyer", "judge"]).optional(),
  limit: z.number().int().min(1).max(120).optional(),
  offset: z.number().int().min(0).optional(),
});

export const GetLawyerCardSchema = z.object({
  id: z.string().optional().describe("Lawyer/judge card id"),
  name: z.string().optional().describe("ФИО (partial match ok)"),
}).refine((v) => Boolean(v.id?.trim() || v.name?.trim()), {
  message: "id or name required",
});

export const GetParticipantDossierSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  role: z.string().optional().describe("Role filter, e.g. representative, plaintiff, all"),
  caseLimit: z.number().int().min(1).max(200).optional(),
}).refine((v) => Boolean(v.id?.trim() || v.name?.trim()), {
  message: "id or name required",
});

export const GetRepresentativesSummarySchema = z.object({
  topPeople: z.number().int().min(5).max(40).optional(),
});

export async function runListLawyers(
  catalog: CaseCatalog,
  input: z.infer<typeof ListLawyersSchema>,
) {
  await ensureLawyerIndexBuild(catalog);
  return listLawyerCards(catalog, {
    q: input.q,
    role: input.role,
    limit: input.limit ?? 48,
    offset: input.offset ?? 0,
  });
}

export async function runGetLawyerCard(
  catalog: CaseCatalog,
  input: z.infer<typeof GetLawyerCardSchema>,
) {
  await ensureLawyerIndexBuild(catalog);
  const key = (input.id ?? input.name ?? "").trim();
  const lawyer = getLawyerCard(catalog, key);
  if (!lawyer && !isLawyerIndexReady()) {
    return { indexReady: false as const, lawyer: null };
  }
  return { indexReady: true as const, lawyer: lawyer ?? null };
}

export function runGetParticipantDossier(
  catalog: CaseCatalog,
  input: z.infer<typeof GetParticipantDossierSchema>,
) {
  warmParticipantIndex(catalog);
  const dossier = buildParticipantDossier(catalog, {
    id: input.id?.trim() || undefined,
    name: input.name?.trim() || undefined,
    role: input.role,
    caseLimit: input.caseLimit,
  });
  return { dossier };
}

/** Compact Mordovia dashboard for MCP (omit heavy deep + full rep matrix). */
export function compactMordoviaAnalytics(catalog: CaseCatalog) {
  const d: MordoviaDashboard = buildMordoviaDashboard(catalog);
  return {
    generatedAt: d.generatedAt,
    region: d.region,
    regionLabel: d.regionLabel,
    totals: d.totals,
    prefixes: d.prefixes,
    outcomes: d.outcomes,
    depersonalization: d.depersonalization,
    courtHeatmap: d.courtHeatmap,
    topCategories: d.topCategories,
    topJudges: d.topJudges,
    professionals: d.professionals,
    winrate: d.winrate,
    participants: d.participants,
    recentEnriched: d.recentEnriched,
    // Pointer: use get_representatives_summary for full rep heatmaps/matrix
    representativesNote:
      "Full representatives/advocates/jurists court density → get_representatives_summary",
  };
}

export function runRepresentativesSummary(
  catalog: CaseCatalog,
  input: z.infer<typeof GetRepresentativesSummarySchema> = {},
) {
  const topN = Math.max(5, Math.min(40, input.topPeople ?? 18));
  const heatmaps = buildRepHeatmapsFromCatalog(catalog, { topPeople: topN });
  return {
    totals: heatmaps.totals,
    byCourt: heatmaps.byCourt,
    topPeople: heatmaps.matrix.people,
    courts: heatmaps.matrix.courts,
    grid: heatmaps.matrix.grid,
    notes: heatmaps.notes,
  };
}
