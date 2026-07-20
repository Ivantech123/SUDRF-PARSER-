import type { CaseParserScheduler } from "./scheduler.js";
import type { Tier2ParserScheduler } from "./tier2-scheduler.js";

export type ParserStatsView = ReturnType<typeof serializeParserStats>;

export function serializeParserStats(
  stats: ReturnType<CaseParserScheduler["getStats"]>,
  tier2?: ReturnType<Tier2ParserScheduler["getStats"]>,
) {
  const iso = (d: Date | string | undefined) =>
    d instanceof Date ? d.toISOString() : d;

  const activeTasks = stats.tasks
    .filter((t) => t.casesFound > 0 || t.casesParsed > 0)
    .sort((a, b) => b.lastParsed.getTime() - a.lastParsed.getTime())
    .slice(0, 40);

  return {
    totalParsed: stats.totalParsed,
    totalFailed: stats.totalFailed,
    totalEnriched: stats.totalEnriched,
    totalDocuments: stats.totalDocuments,
    catalogSize: stats.catalogSize,
    enrichPending: stats.enrichPending,
    withDocuments: stats.withDocuments,
    withActText: stats.withActText,
    lastUpdate: iso(stats.lastUpdate),
    running: stats.running,
    tasksTotal: stats.tasksTotal,
    readyNow: stats.readyNow,
    tasks: activeTasks.map((t) => ({
      court: t.court,
      lastParsed: iso(t.lastParsed),
      casesFound: t.casesFound,
      casesParsed: t.casesParsed,
      nextScheduled: iso(t.nextScheduled),
    })),
    tier2: tier2
      ? {
          running: tier2.running,
          courtsTotal: tier2.courtsTotal,
          region: tier2.region,
          entryDateFrom: tier2.entryDateFrom,
          entryDateTo: tier2.entryDateTo,
          totalSearches: tier2.totalSearches,
          totalCollected: tier2.totalCollected,
          totalFailed: tier2.totalFailed,
          lastCourt: tier2.lastCourt,
          lastError: tier2.lastError || undefined,
          lastUpdate: iso(tier2.lastUpdate),
        }
      : undefined,
  };
}
