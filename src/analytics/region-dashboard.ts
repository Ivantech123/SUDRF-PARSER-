// Aggregated Mordovia dashboard: court heatmap + detailed catalog analytics.

import type { CaseCatalog, StoredCase } from "../cases/store.js";
import { analyzeStoredCase, buildReport } from "./depersonalization.js";
import { classifyOutcome, summarizeOutcomes, type OutcomeLabel } from "./outcome.js";
import { buildWinrateReport } from "./winrate.js";
import { buildDeepAnalytics, type DeepAnalytics } from "./deep-analytics.js";
import { listLawyerCards, isLawyerIndexReady, warmLawyerIndex } from "../lawyers/aggregate.js";
import { listParticipants, warmParticipantIndex } from "../participants/aggregate.js";
import { buildRepHeatmaps, type RepHeatmaps } from "./rep-heatmap.js";

export interface CourtHeatCell {
  subdomain: string;
  name: string;
  total: number;
  enriched: number;
  withActText: number;
  firstInstance: number;
  appealLike: number;
  identifiableReps: number;
  intensity: number; // 0..1 vs max total
}

export interface MordoviaDashboard {
  generatedAt: string;
  region: string;
  regionLabel: string;
  totals: {
    catalog: number;
    enriched: number;
    withActText: number;
    withDocuments: number;
    firstInstance: number;
    appealLike: number;
    pendingEnrich: number;
  };
  prefixes: Record<string, number>;
  outcomes: {
    allEnriched: ReturnType<typeof summarizeOutcomes>;
    firstInstance: ReturnType<typeof summarizeOutcomes>;
  };
  depersonalization: {
    allEnriched: ReturnType<typeof buildReport> extends infer R
      ? Omit<R, "cases">
      : never;
    firstInstance: Omit<ReturnType<typeof buildReport>, "cases">;
  };
  courtHeatmap: CourtHeatCell[];
  topCategories: Array<{ name: string; count: number }>;
  topJudges: Array<{ name: string; cases: number }>;
  professionals: {
    lawyers: number;
    judges: number;
    indexReady: boolean;
  };
  winrate: ReturnType<typeof buildWinrateReport>;
  deep: DeepAnalytics;
  participants: {
    representatives: number;
    plaintiffs: number;
    defendants: number;
    third: number;
    topRepresentatives: Array<{ name: string; cases: number; courts: number; withActs: number }>;
  };
  /** Representatives / advocates / jurists — court density + people×courts matrix */
  repHeatmaps: RepHeatmaps;
  recentEnriched: Array<{
    caseNumber: string;
    court: string;
    status?: string;
    hasActText: boolean;
    enrichedAt?: string;
  }>;
}

function prefixOf(num: string): string {
  const m = num.trim().match(/^(\d+[аaАA]?)/);
  return (m?.[1] ?? "?").toLowerCase();
}

function isFi(num: string): boolean {
  return /^2/i.test(num.trim());
}

function isAppealLike(num: string): boolean {
  return /^11-/.test(num.trim());
}

function stripReportCases(r: ReturnType<typeof buildReport>) {
  const { cases: _c, ...rest } = r;
  return rest;
}

export function buildMordoviaDashboard(catalog: CaseCatalog): MordoviaDashboard {
  const all: StoredCase[] = [];
  catalog.forEach((c) => {
    if (c.courtRegion && c.courtRegion !== "13") return;
    // also keep --mor courts without region set
    if (!c.courtRegion && !/--mor$/i.test(c.courtSubdomain)) return;
    all.push(c);
  });

  const enriched = all.filter((c) => c.enrichedAt);
  const fi = enriched.filter((c) => isFi(c.caseNumber));
  const appeal = enriched.filter((c) => isAppealLike(c.caseNumber));

  const prefixes: Record<string, number> = {};
  for (const c of enriched) {
    const p = prefixOf(c.caseNumber);
    prefixes[p] = (prefixes[p] ?? 0) + 1;
  }

  const outcomesAll = summarizeOutcomes(
    enriched.map((c) =>
      classifyOutcome({
        status: c.status,
        events: c.events,
        documentText: c.documents.map((d) => d.text ?? "").join("\n"),
      }),
    ),
  );
  const outcomesFi = summarizeOutcomes(
    fi.map((c) =>
      classifyOutcome({
        status: c.status,
        events: c.events,
        documentText: c.documents.map((d) => d.text ?? "").join("\n"),
      }),
    ),
  );

  const depersAll = stripReportCases(buildReport(enriched.map(analyzeStoredCase)));
  const depersFi = stripReportCases(buildReport(fi.map(analyzeStoredCase)));

  // Court heatmap
  const byCourt = new Map<
    string,
    {
      subdomain: string;
      name: string;
      total: number;
      enriched: number;
      withActText: number;
      firstInstance: number;
      appealLike: number;
      identifiableReps: number;
    }
  >();
  for (const c of all) {
    let cell = byCourt.get(c.courtSubdomain);
    if (!cell) {
      cell = {
        subdomain: c.courtSubdomain,
        name: c.courtName,
        total: 0,
        enriched: 0,
        withActText: 0,
        firstInstance: 0,
        appealLike: 0,
        identifiableReps: 0,
      };
      byCourt.set(c.courtSubdomain, cell);
    }
    cell.total++;
    if (c.enrichedAt) cell.enriched++;
    if (c.hasActText) cell.withActText++;
    if (isFi(c.caseNumber)) cell.firstInstance++;
    if (isAppealLike(c.caseNumber)) cell.appealLike++;
  }
  for (const c of enriched) {
    const a = analyzeStoredCase(c);
    if (a.representativeIdentifiable) {
      const cell = byCourt.get(c.courtSubdomain);
      if (cell) cell.identifiableReps++;
    }
  }
  const maxTotal = Math.max(1, ...[...byCourt.values()].map((x) => x.total));
  const courtHeatmap: CourtHeatCell[] = [...byCourt.values()]
    .map((x) => ({ ...x, intensity: x.total / maxTotal }))
    .sort((a, b) => b.total - a.total);

  // Categories / judges
  const catCount = new Map<string, number>();
  const judgeCount = new Map<string, number>();
  for (const c of enriched) {
    const cat = (c.category || "—").split("→")[0]!.trim().slice(0, 80);
    catCount.set(cat, (catCount.get(cat) ?? 0) + 1);
    if (c.judge?.trim()) {
      const j = c.judge.replace(/\s+/g, " ").trim();
      judgeCount.set(j, (judgeCount.get(j) ?? 0) + 1);
    }
  }
  const topCategories = [...catCount.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);
  const topJudges = [...judgeCount.entries()]
    .map(([name, cases]) => ({ name, cases }))
    .sort((a, b) => b.cases - a.cases)
    .slice(0, 15);

  warmLawyerIndex(catalog);
  const cards = listLawyerCards(catalog, { limit: 5000, offset: 0 });
  const morCards = cards.lawyers.filter(
    (card) => card.region === "13" || card.regions.includes("13") || /--mor$/i.test(card.mainCourtSubdomain),
  );

  const winrate = buildWinrateReport(fi, { minCases: 2 });
  const deep = buildDeepAnalytics(all, { minJudgeCases: 5 });

  warmParticipantIndex(catalog);
  const partAll = listParticipants(catalog, { limit: 1, offset: 0 });
  const facet = (f: string) => partAll.facets.find((x) => x.family === f)?.people ?? 0;
  const topRep = listParticipants(catalog, { role: "representative", limit: 20, minCases: 1 }).people.map((p) => ({
    name: p.name,
    cases: p.cases,
    courts: p.courts,
    withActs: p.withActs,
  }));
  const repHeatmaps = buildRepHeatmaps(all);

  const recentEnriched = [...enriched]
    .sort((a, b) => (b.enrichedAt ?? "").localeCompare(a.enrichedAt ?? ""))
    .slice(0, 20)
    .map((c) => ({
      caseNumber: c.caseNumber,
      court: c.courtSubdomain,
      status: c.status,
      hasActText: c.hasActText,
      enrichedAt: c.enrichedAt,
    }));

  return {
    generatedAt: new Date().toISOString(),
    region: "13",
    regionLabel: "Республика Мордовия",
    totals: {
      catalog: all.length,
      enriched: enriched.length,
      withActText: enriched.filter((c) => c.hasActText).length,
      withDocuments: enriched.filter((c) => c.documentsCount > 0 || c.documents.length > 0).length,
      firstInstance: fi.length,
      appealLike: appeal.length,
      pendingEnrich: all.filter((c) => c.caseUrl && !c.enrichedAt).length,
    },
    prefixes,
    outcomes: { allEnriched: outcomesAll, firstInstance: outcomesFi },
    depersonalization: { allEnriched: depersAll, firstInstance: depersFi },
    courtHeatmap,
    topCategories,
    topJudges,
    professionals: {
      lawyers: morCards.filter((c) => c.primaryRole === "lawyer").length,
      judges: morCards.filter((c) => c.primaryRole === "judge").length,
      indexReady: cards.indexReady || isLawyerIndexReady(),
    },
    winrate,
    deep,
    participants: {
      representatives: facet("representative"),
      plaintiffs: facet("plaintiff"),
      defendants: facet("defendant"),
      third: facet("third"),
      topRepresentatives: topRep,
    },
    repHeatmaps,
    recentEnriched,
  };
}

export type { OutcomeLabel };
