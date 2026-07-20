// Automated case parsing scheduler — collects cases from court hearing schedules
// into the CaseCatalog (fast), optionally enriches cards and RAG (slow).

import type { SudrfClient } from "../sudrf/index.js";
import type { RagIndex } from "../rag/index.js";
import type { CaseCatalog } from "../cases/store.js";
import { COURT_REGISTRY, courtsByRegion, type CourtEntry } from "../sudrf/courts.js";

interface ParserStats {
  totalParsed: number;
  totalFailed: number;
  totalEnriched: number;
  totalDocuments: number;
  lastUpdate: Date;
  activeCourts: Set<string>;
  errors: Array<{ court: string; error: string; timestamp: Date }>;
}

interface CourtTask {
  court: string;
  lastParsed: Date;
  casesFound: number;
  casesParsed: number;
  nextScheduled: Date;
  failCount: number;
}

function courtScore(c: CourtEntry): number {
  let s = 0;
  if (c.http && !c.captcha) s += 100;
  else if (c.http) s += 40;
  if (c.type === "ray") s += 30;
  if (c.type === "vs" || c.type === "oblsud") s += 15;
  if (/kas$/i.test(c.subdomain) || /^[0-9]+kas$/i.test(c.subdomain)) s -= 80;
  return s;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export class CaseParserScheduler {
  private stats: ParserStats = {
    totalParsed: 0,
    totalFailed: 0,
    totalEnriched: 0,
    totalDocuments: 0,
    lastUpdate: new Date(),
    activeCourts: new Set(),
    errors: [],
  };

  private tasks = new Map<string, CourtTask>();
  private rotationOrder: string[] = [];
  private rotationCursor = 0;
  private running = false;
  private loopActive = false;
  private intervalId?: NodeJS.Timeout;
  private courtBySub = new Map(COURT_REGISTRY.map((c) => [c.subdomain, c]));

  constructor(
    private client: SudrfClient,
    private catalog: CaseCatalog,
    private rag: RagIndex,
    private saveRag: () => void,
    private options: {
      casesPerHour?: number;
      courtsConcurrent?: number;
      startDelay?: number;
      enrichPerCourt?: number;
      enrichQueuePerTick?: number;
      detailTimeoutMs?: number;
      tickIntervalMs?: number;
      rescheduleMinutes?: { hit: number; miss: number; error: number };
      scheduleDays?: number;
      scheduleDaysBack?: number;
      enrichDelayMs?: number;
      /** Prioritize document enrichment for this federal subject code (e.g. "13") */
      enrichRegion?: string;
      /** Limit Tier-1 schedule collection to one federal subject code (e.g. "13") */
      region?: string;
      /** Tier-1 schedule fetch; set false when Go parser-worker owns collection */
      scheduleCollection?: boolean;
      /** Document enrich queue; set false when Go worker posts HTML to /api/internal/enrich-html */
      enrichQueue?: boolean;
    } = {},
  ) {
    this.options.casesPerHour = options.casesPerHour ?? 100;
    this.options.courtsConcurrent = options.courtsConcurrent ?? 3;
    this.options.startDelay = options.startDelay ?? 5000;
    this.options.enrichPerCourt = options.enrichPerCourt ?? 5;
    this.options.enrichQueuePerTick = options.enrichQueuePerTick ?? 12;
    this.options.detailTimeoutMs = options.detailTimeoutMs ?? 25_000;
    this.options.tickIntervalMs = options.tickIntervalMs ?? 60_000;
    this.options.rescheduleMinutes = options.rescheduleMinutes ?? { hit: 10, miss: 20, error: 30 };
    this.options.scheduleDays = options.scheduleDays ?? 7;
    this.options.scheduleDaysBack = options.scheduleDaysBack ?? 0;
    this.options.enrichDelayMs = options.enrichDelayMs ?? 1500;
    this.options.scheduleCollection = options.scheduleCollection ?? true;
    this.options.enrichQueue = options.enrichQueue ?? true;
  }

  start(): void {
    if (this.running) return;

    console.log("[parser-scheduler] Starting automated case parsing...");
    console.log(`[parser-scheduler] Target: ${this.options.casesPerHour} enrichments/hour`);
    console.log(`[parser-scheduler] Concurrent courts: ${this.options.courtsConcurrent}`);
    console.log(`[parser-scheduler] Enrich per court: ${this.options.enrichPerCourt}, queue/tick: ${this.options.enrichQueuePerTick}`);
    if (this.options.enrichRegion) {
      console.log(`[parser-scheduler] Enrich priority region: ${this.options.enrichRegion}`);
    }
    if (this.options.region) {
      console.log(`[parser-scheduler] Collection limited to region: ${this.options.region}`);
    }
    const back = this.options.scheduleDaysBack!;
    const fwd = this.options.scheduleDays!;
    const windowLabel = back > 0 ? `-${back}..+${fwd - 1}d` : `${fwd}d forward`;
    console.log(`[parser-scheduler] Schedule window: ${windowLabel}, tick every ${this.options.tickIntervalMs! / 1000}s`);

    this.running = true;

    setTimeout(() => {
      if (this.options.scheduleCollection) {
        this.scheduleAllCourts();
      } else {
        console.log("[parser-scheduler] Tier-1 collection disabled (external worker); enrich-only mode");
      }
      if (!this.options.enrichQueue) {
        console.log("[parser-scheduler] Enrich queue disabled (Go parser-worker)");
      }
      void this.runLoop();
    }, this.options.startDelay);
  }

  stop(): void {
    if (!this.running) return;
    console.log("[parser-scheduler] Stopping automated case parsing...");
    this.running = false;
    if (this.intervalId) clearInterval(this.intervalId);
  }

  private async runLoop(): Promise<void> {
    if (this.loopActive) return;
    this.loopActive = true;

    while (this.running) {
      try {
        await this.tick();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[parser-scheduler] loop error: ${msg}`);
      }
      await new Promise((r) => setTimeout(r, this.options.tickIntervalMs!));
    }

    this.loopActive = false;
  }

  private scheduleAllCourts(): void {
    const pool = this.options.region
      ? courtsByRegion(this.options.region)
      : COURT_REGISTRY;
    const sorted = [...pool].sort((a, b) => courtScore(b) - courtScore(a));

    for (const court of sorted) {
      if (!this.tasks.has(court.subdomain)) {
        this.tasks.set(court.subdomain, {
          court: court.subdomain,
          lastParsed: new Date(0),
          casesFound: 0,
          casesParsed: 0,
          nextScheduled: new Date(),
          failCount: 0,
        });
      }
    }

    this.rotationOrder = sorted.map((c) => c.subdomain);
    const fast = sorted.filter((c) => c.http && !c.captcha).length;
    console.log(`[parser-scheduler] Scheduled ${this.tasks.size} courts (${fast} fast HTTP), round-robin rotation`);
  }

  /** Pick up to `limit` courts ready for parsing, scanning round-robin from cursor. */
  private pickReadyCourts(limit: number): CourtTask[] {
    const now = Date.now();
    const picked: CourtTask[] = [];
    const total = this.rotationOrder.length;
    if (!total) return picked;

    let scanned = 0;
    while (picked.length < limit && scanned < total) {
      const sub = this.rotationOrder[this.rotationCursor]!;
      this.rotationCursor = (this.rotationCursor + 1) % total;
      scanned++;
      const task = this.tasks.get(sub);
      if (task && task.nextScheduled.getTime() <= now) picked.push(task);
    }
    return picked;
  }

  private touchParsed(task: CourtTask): void {
    task.lastParsed = new Date();
  }

  private scheduleNext(task: CourtTask, minutesFromNow: number): void {
    task.nextScheduled = new Date(Date.now() + minutesFromNow * 60 * 1000);
    console.log(`[parser-scheduler] ${task.court} — next at ${task.nextScheduled.toLocaleString("ru-RU")}`);
  }

  private scheduleError(task: CourtTask): void {
    task.failCount++;
    // Exponential backoff: 15 → 22 → 33 → … capped at 90 min, never dropped.
    const base = this.options.rescheduleMinutes!.error;
    const minutes = Math.min(base * Math.pow(1.5, task.failCount - 1), 90);
    this.scheduleNext(task, minutes);
  }

  private async tick(): Promise<void> {
    if (!this.running) return;

    if (this.options.scheduleCollection) {
      const ready = this.pickReadyCourts(this.options.courtsConcurrent!);

      if (ready.length === 0) {
        const waiting = this.rotationOrder.filter((s) => {
          const t = this.tasks.get(s);
          return t && t.nextScheduled.getTime() > Date.now();
        }).length;
        console.log(`[parser-scheduler] No courts ready (${waiting}/${this.rotationOrder.length} in backoff), waiting...`);
      } else {
        console.log(`[parser-scheduler] Parsing ${ready.length} courts: ${ready.map((t) => t.court).join(", ")}`);
        await Promise.all(ready.map((task) => this.parseCourt(task)));
      }
    }

    if (this.options.enrichQueue) {
      await this.enrichQueue(this.options.enrichQueuePerTick!);
    }

    this.stats.lastUpdate = new Date();
    const enrich = this.catalog.enrichmentStats();
    console.log(
      `[parser-scheduler] Stats: ${this.stats.totalParsed} collected, ` +
      `${this.stats.totalEnriched} enriched (${this.stats.totalDocuments} docs), ` +
      `${this.stats.totalFailed} failed, catalog=${this.catalog.size}, pending=${enrich.pending}`,
    );
  }

  /** Fetch case card + documents for one catalog entry. */
  private async enrichOne(id: string, subdomain: string, caseUrl: string): Promise<number> {
    if (this.catalog.get(id)?.enrichedAt) return 0;

    const details = await withTimeout(
      this.client.getCaseDetails(subdomain, caseUrl),
      this.options.detailTimeoutMs!,
      "getCaseDetails",
    );
    const chunks = this.rag.addCase(details, false);
    this.catalog.enrichFromDetails(id, details, chunks > 0);
    if (chunks > 0) {
      this.catalog.markHasActText(id);
      this.saveRag();
    }
    this.catalog.flush();

    const docCount = details.documents?.length ?? 0;
    this.stats.totalEnriched++;
    this.stats.totalDocuments += docCount;
    return docCount;
  }

  private enrichDelayMs(): number {
    return Math.min((3600 * 1000) / this.options.casesPerHour!, this.options.enrichDelayMs!);
  }

  private async enrichQueue(limit: number): Promise<void> {
    const pending = this.catalog.listPendingEnrichment(limit, {
      region: this.options.enrichRegion,
    });
    if (!pending.length) return;

    console.log(`[parser-scheduler] Document queue: ${pending.length} cases...`);
    for (const c of pending) {
      if (!this.running || !c.caseUrl) continue;
      try {
        const docs = await this.enrichOne(c.id, c.courtSubdomain, c.caseUrl);
        console.log(`[parser-scheduler] ${c.courtSubdomain} — enriched ${c.caseNumber} (docs=${docs})`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[parser-scheduler] enrich failed ${c.caseNumber}: ${msg}`);
        this.stats.totalFailed++;
        this.stats.errors.push({ court: c.courtSubdomain, error: msg, timestamp: new Date() });
        if (this.stats.errors.length > 100) this.stats.errors.shift();
      }
      await new Promise((r) => setTimeout(r, this.enrichDelayMs()));
    }
  }

  private async parseCourt(
    task: CourtTask,
    window?: { daysBack?: number; daysForward?: number },
  ): Promise<void> {
    const subdomain = task.court;
    const courtEntry = this.courtBySub.get(subdomain) ?? this.client.resolveCourt(subdomain);

    this.stats.activeCourts.add(subdomain);

    try {
      console.log(`[parser-scheduler] ${subdomain} — fetching schedule...`);

      const dates = this.scheduleDates(window);
      let allItems: Awaited<ReturnType<SudrfClient["getHearingSchedule"]>>["items"] = [];

      for (const dateStr of dates) {
        try {
          const schedule = await this.client.getHearingSchedule(subdomain, dateStr);
          allItems = allItems.concat(schedule.items ?? []);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[parser-scheduler] ${subdomain} — schedule ${dateStr} failed: ${msg}`);
        }
      }

      task.casesFound = allItems.length;

      if (allItems.length === 0) {
        console.log(`[parser-scheduler] ${subdomain} — no hearings in ${dates.length}-day window`);
        this.touchParsed(task);
        task.failCount = 0;
        this.scheduleNext(task, this.options.rescheduleMinutes!.miss);
        return;
      }

      console.log(`[parser-scheduler] ${subdomain} — ${allItems.length} hearings (${dates.length} days), collecting...`);

      let collected = 0;
      for (const item of allItems) {
        if (this.catalog.upsertFromHearing(courtEntry, item)) {
          collected++;
          this.stats.totalParsed++;
        }
      }

      task.casesParsed += collected;
      this.catalog.flush();
      console.log(`[parser-scheduler] ${subdomain} — saved ${collected} new cases (catalog=${this.catalog.size})`);

      let enriched = 0;
      const enrichLimit = this.options.enrichPerCourt!;
      for (const item of allItems) {
        if (enriched >= enrichLimit || !item.caseUrl) continue;

        const id = item.caseUid ?? `${subdomain}:${item.caseNumber}`;
        if (this.catalog.get(id)?.enrichedAt) continue;

        try {
          const docs = await this.enrichOne(id, subdomain, item.caseUrl);
          enriched++;
          console.log(`[parser-scheduler] ${subdomain} — enriched ${item.caseNumber} (docs=${docs})`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[parser-scheduler] ${subdomain} — enrich failed ${item.caseNumber}: ${msg}`);
          this.stats.totalFailed++;
          this.stats.errors.push({ court: subdomain, error: msg, timestamp: new Date() });
          if (this.stats.errors.length > 100) this.stats.errors.shift();
        }

        await new Promise((r) => setTimeout(r, this.enrichDelayMs()));
      }

      task.lastParsed = new Date();
      task.failCount = 0;
      this.scheduleNext(task, collected > 0 ? this.options.rescheduleMinutes!.hit : this.options.rescheduleMinutes!.miss);
    } catch (e) {
      this.stats.totalFailed++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[parser-scheduler] ${subdomain} — critical error: ${msg}`);
      this.stats.errors.push({ court: subdomain, error: msg, timestamp: new Date() });
      if (this.stats.errors.length > 100) this.stats.errors.shift();
      this.touchParsed(task);
      this.scheduleError(task);
    } finally {
      this.stats.activeCourts.delete(subdomain);
    }
  }

  private formatScheduleDate(d: Date): string {
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
  }

  private scheduleDates(window?: { daysBack?: number; daysForward?: number }): string[] {
    const daysForward = window?.daysForward ?? this.options.scheduleDays!;
    const daysBack = window?.daysBack ?? this.options.scheduleDaysBack ?? 0;
    const out: string[] = [];
    const base = new Date();
    for (let i = -daysBack; i < daysForward; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      out.push(this.formatScheduleDate(d));
    }
    return out;
  }

  getStats(): {
    totalParsed: number;
    totalFailed: number;
    totalEnriched: number;
    totalDocuments: number;
    lastUpdate: Date;
    running: boolean;
    tasks: CourtTask[];
    catalogSize: number;
    enrichPending: number;
    withDocuments: number;
    withActText: number;
    tasksTotal: number;
    readyNow: number;
  } {
    const enrich = this.catalog.enrichmentStats();
    const now = Date.now();
    const readyNow = [...this.tasks.values()].filter((t) => t.nextScheduled.getTime() <= now).length;
    return {
      totalParsed: this.stats.totalParsed,
      totalFailed: this.stats.totalFailed,
      totalEnriched: this.stats.totalEnriched,
      totalDocuments: this.stats.totalDocuments,
      lastUpdate: this.stats.lastUpdate,
      running: this.running,
      tasks: Array.from(this.tasks.values()),
      catalogSize: this.catalog.size,
      enrichPending: enrich.pending,
      withDocuments: enrich.withDocuments,
      withActText: enrich.withActText,
      tasksTotal: this.tasks.size,
      readyNow,
    };
  }

  private ensureTask(subdomain: string): CourtTask {
    let task = this.tasks.get(subdomain);
    if (!task) {
      task = {
        court: subdomain,
        lastParsed: new Date(0),
        casesFound: 0,
        casesParsed: 0,
        nextScheduled: new Date(0),
        failCount: 0,
      };
      this.tasks.set(subdomain, task);
      if (!this.rotationOrder.includes(subdomain)) this.rotationOrder.push(subdomain);
    }
    return task;
  }

  async triggerCourt(
    courtQuery: string,
    opts?: { daysBack?: number; daysForward?: number },
  ): Promise<{ collected: number; enriched: number; documents: number; errors: string[] }> {
    const court = this.client.resolveCourt(courtQuery);
    const task = this.ensureTask(court.subdomain);

    const beforeEnriched = this.stats.totalEnriched;
    const beforeDocs = this.stats.totalDocuments;
    const beforeSize = this.catalog.size;
    await this.parseCourt(task, opts);
    this.tasks.set(court.subdomain, task);

    return {
      collected: this.catalog.size - beforeSize,
      enriched: this.stats.totalEnriched - beforeEnriched,
      documents: this.stats.totalDocuments - beforeDocs,
      errors: this.stats.errors.filter((e) => e.court === court.subdomain).map((e) => e.error),
    };
  }

  /** Manually drain the document enrichment queue (case cards + act texts). */
  async triggerEnrich(limit = 20, region?: string): Promise<{ enriched: number; documents: number; errors: string[] }> {
    const beforeEnriched = this.stats.totalEnriched;
    const beforeDocs = this.stats.totalDocuments;
    const errors: string[] = [];
    const pending = this.catalog.listPendingEnrichment(limit, {
      region: region ?? this.options.enrichRegion,
    });

    for (const c of pending) {
      if (!c.caseUrl) continue;
      try {
        const docs = await this.enrichOne(c.id, c.courtSubdomain, c.caseUrl);
        console.log(`[parser-scheduler] manual enrich ${c.caseNumber} docs=${docs}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${c.caseNumber}: ${msg}`);
      }
      await new Promise((r) => setTimeout(r, this.enrichDelayMs()));
    }

    return {
      enriched: this.stats.totalEnriched - beforeEnriched,
      documents: this.stats.totalDocuments - beforeDocs,
      errors,
    };
  }
}
