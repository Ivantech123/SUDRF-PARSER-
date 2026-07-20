// Tier-2 auto collector: extended search (Playwright + captcha) for courts
// that Tier-1 schedule fetch doesn't cover well (captcha / SELENIUM-only).

import { COURT_REGISTRY, courtsByRegion, type CourtEntry } from "../sudrf/courts.js";
import type { SudrfClient } from "../sudrf/index.js";
import type { CaseCatalog } from "../cases/store.js";
import type { SearchFilters } from "../sudrf/categories.js";

// civil, criminal, admin (КоАП), КАС, appeal — admin/КАС are the highest-volume
// categories and are required to approach the 600k target for a region.
const DEFAULT_DELO_IDS = [5, 4, 1540006, 1540005, 41];
/** SUDRF extended search requires explicit DD.MM.YYYY bounds; wide span for "all years". */
export const ALL_YEARS_ENTRY_FROM = "01.01.2010";
export const ALL_YEARS_ENTRY_TO = "31.12.2030";

function formatDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

function parseDMY(s: string): Date {
  const [d, m, y] = s.split(".").map(Number);
  return new Date(y!, m! - 1, d!);
}

function entryDateRange(daysBack: number): SearchFilters {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - daysBack);
  return { entryDateFrom: formatDate(from), entryDateTo: formatDate(to) };
}

/** Split a wide entry-date span into monthly windows (SUDRF times out on huge ranges). */
export function monthEntryWindows(fromStr: string, toStr: string): SearchFilters[] {
  const start = parseDMY(fromStr);
  const end = parseDMY(toStr);
  const windows: SearchFilters[] = [];
  let y = start.getFullYear();
  let m = start.getMonth();

  while (y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth())) {
    const monthStart = new Date(y, m, 1);
    const monthEnd = new Date(y, m + 1, 0);
    const effectiveStart = monthStart < start ? start : monthStart;
    const effectiveEnd = monthEnd > end ? end : monthEnd;
    if (effectiveStart <= effectiveEnd) {
      windows.push({
        entryDateFrom: formatDate(effectiveStart),
        entryDateTo: formatDate(effectiveEnd),
      });
    }
    m++;
    if (m > 11) {
      m = 0;
      y++;
    }
  }

  return windows.length ? windows : [{ entryDateFrom: fromStr, entryDateTo: toStr }];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class Tier2ParserScheduler {
  private running = false;
  private loopActive = false;
  private readonly courts: CourtEntry[];
  private cursor = 0;
  private deloCursor = 0;
  private dateCursor = 0;
  private readonly dateWindows: SearchFilters[];
  private readonly dateFilters: SearchFilters;
  private stats = {
    totalSearches: 0,
    totalCollected: 0,
    totalFailed: 0,
    lastCourt: "",
    lastError: "",
    lastUpdate: new Date(),
  };

  constructor(
    private client: SudrfClient,
    private catalog: CaseCatalog,
    private options: {
      daysBack?: number;
      entryDateFrom?: string;
      entryDateTo?: string;
      /** Limit auto-loop to one federal subject code, e.g. "13" (Мордовия) */
      region?: string;
      deloIds?: number[];
      /** Limit auto-loop to comma-separated court subdomains */
      courts?: string[];
      startDelay?: number;
      tickIntervalMs?: number;
      /** true = only captcha / non-HTTP courts (default) */
      tier2Only?: boolean;
    } = {},
  ) {
    const tier2Only = options.tier2Only ?? true;
    const pool = options.region
      ? courtsByRegion(options.region)
      : COURT_REGISTRY;
    this.courts = pool.filter((c) => (tier2Only ? c.captcha || !c.http : true));
    const courtFilter = options.courts?.map((s) => s.trim()).filter(Boolean);
    if (courtFilter?.length) {
      const allowed = new Set(courtFilter);
      this.courts = this.courts.filter((c) => allowed.has(c.subdomain));
    }
    this.courts.sort((a, b) => a.subdomain.localeCompare(b.subdomain));

    if (options.entryDateFrom && options.entryDateTo) {
      this.dateWindows = monthEntryWindows(options.entryDateFrom, options.entryDateTo);
      this.dateFilters = this.dateWindows[0]!;
    } else if (options.region) {
      this.dateWindows = monthEntryWindows(ALL_YEARS_ENTRY_FROM, ALL_YEARS_ENTRY_TO);
      this.dateFilters = this.dateWindows[0]!;
    } else {
      const range = entryDateRange(options.daysBack ?? 60);
      this.dateWindows = [range];
      this.dateFilters = range;
    }
  }

  private currentDateFilters(): SearchFilters {
    if (this.dateWindows.length <= 1) return this.dateFilters;
    return this.dateWindows[this.dateCursor % this.dateWindows.length]!;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const deloIds = this.options.deloIds ?? DEFAULT_DELO_IDS;
    const regionNote = this.options.region ? ` region=${this.options.region}` : "";
    const span =
      this.dateWindows.length > 1
        ? `${this.dateWindows[0]!.entryDateFrom}–${this.dateWindows.at(-1)!.entryDateTo} (${this.dateWindows.length} monthly windows)`
        : `${this.dateFilters.entryDateFrom}–${this.dateFilters.entryDateTo}`;
    console.log(
      `[tier2-scheduler] Starting Tier-2 search on ${this.courts.length} courts${regionNote}, ` +
      `delo_ids=[${deloIds.join(",")}], ${span}`,
    );
    setTimeout(() => void this.runLoop(), this.options.startDelay ?? 30_000);
  }

  stop(): void {
    this.running = false;
    console.log("[tier2-scheduler] Stopped");
  }

  /** One-shot extended search (manual trigger / batch scripts). */
  async triggerSearch(
    courtQuery: string,
    deloId: number,
    filters?: SearchFilters,
  ): Promise<{ hits: number; collected: number; errors: string[] }> {
    const court = this.client.resolveCourt(courtQuery);
    const dates = filters ?? this.dateFilters;
    const errors: string[] = [];

    try {
      const res = await this.client.searchCases(court.subdomain, deloId, dates);
      let collected = 0;
      for (const r of res.results) {
        if (this.catalog.upsertFromSearchResult(court, r)) collected++;
      }
      this.catalog.flush();
      this.stats.totalSearches++;
      this.stats.totalCollected += collected;
      this.stats.lastCourt = court.subdomain;
      this.stats.lastError = "";
      this.stats.lastUpdate = new Date();
      console.log(
        `[tier2-scheduler] trigger ${court.subdomain} delo=${deloId} — ` +
        `${res.results.length} hits, ${collected} new`,
      );
      return { hits: res.results.length, collected, errors };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.stats.totalFailed++;
      this.stats.lastError = msg.slice(0, 200);
      this.stats.lastCourt = court.subdomain;
      this.stats.lastUpdate = new Date();
      errors.push(msg);
      return { hits: 0, collected: 0, errors };
    }
  }

  private async runLoop(): Promise<void> {
    if (this.loopActive) return;
    this.loopActive = true;
    while (this.running) {
      try {
        await this.tick();
      } catch (e) {
        console.error("[tier2-scheduler] loop error:", e);
      }
      if (this.running) {
        await sleep(this.options.tickIntervalMs ?? 5000);
      }
    }
    this.loopActive = false;
  }

  private async tick(): Promise<void> {
    if (!this.courts.length) return;

    const court = this.courts[this.cursor % this.courts.length]!;
    this.cursor++;

    const deloIds = this.options.deloIds ?? DEFAULT_DELO_IDS;
    const deloId = deloIds[this.deloCursor % deloIds.length]!;
    this.deloCursor++;

    const dates = this.currentDateFilters();
    console.log(
      `[tier2-scheduler] ${court.subdomain} delo_id=${deloId} ` +
      `(${dates.entryDateFrom}–${dates.entryDateTo})`,
    );

    const { hits, collected } = await this.triggerSearch(court.subdomain, deloId, dates);
    if (this.dateWindows.length > 1) this.dateCursor++;
    console.log(
      `[tier2-scheduler] ${court.subdomain} — ${hits} hits, ${collected} new (catalog=${this.catalog.size})`,
    );
  }

  getStats(): {
    running: boolean;
    courtsTotal: number;
    cursor: number;
    totalSearches: number;
    totalCollected: number;
    totalFailed: number;
    lastCourt: string;
    lastError: string;
    lastUpdate: Date;
    region?: string;
    entryDateFrom?: string;
    entryDateTo?: string;
  } {
    return {
      running: this.running,
      courtsTotal: this.courts.length,
      cursor: this.cursor,
      region: this.options.region,
      entryDateFrom: this.dateWindows[0]?.entryDateFrom ?? this.dateFilters.entryDateFrom,
      entryDateTo: this.dateWindows.at(-1)?.entryDateTo ?? this.dateFilters.entryDateTo,
      ...this.stats,
    };
  }
}
