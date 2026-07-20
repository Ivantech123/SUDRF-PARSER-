// Case catalog: metadata-rich store for the web UI. Separate from RAG (which
// holds full act texts). Populated from hearing schedules (fast) and enriched
// from case cards when details are available.

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  statSync,
  openSync,
  closeSync,
  unlinkSync,
  renameSync,
  copyFileSync,
} from "node:fs";
import { dirname } from "node:path";

/** Sync sleep without burning a core (used while waiting on catalog lock). */
function sleepSyncMs(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, Math.max(1, ms));
}

function pidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Keep full act text only in RAG. Catalog stores metadata + hasText flag.
 * Set CATALOG_STORE_ACT_TEXT=1 to keep legacy dual-storage (not recommended).
 */
export function catalogStoresActText(): boolean {
  return process.env.CATALOG_STORE_ACT_TEXT === "1";
}

/** Drop bulky document bodies before disk write / enrich persist. */
export function stripDocumentTexts(c: StoredCase): StoredCase {
  if (!c.documents?.length) return c;
  let changed = false;
  const documents = c.documents.map((d) => {
    if (!d.text) return d;
    changed = true;
    return {
      docId: d.docId,
      name: d.name,
      date: d.date,
      caseNumber: d.caseNumber,
      url: d.url,
      hasText: d.hasText || d.text.trim().length > 0,
    };
  });
  return changed ? { ...c, documents } : c;
}
import type { CaseDetails, CaseEvent, CaseParticipant, HearingItem, CaseSearchResult } from "../sudrf/types.js";
import { diffCase, mergeChangeLog, type CaseChange } from "./sync.js";
import type { CourtEntry } from "../sudrf/courts.js";

/**
 * Cross-process exclusive lock so schedule collect + enrich can share one store.
 * Stale locks (dead PID or age > CATALOG_LOCK_STALE_MS) are stolen — otherwise
 * a crashed writer freezes every collector.
 */
function withCatalogFileLock(storePath: string, fn: () => void): void {
  const lockPath = `${storePath}.lock`;
  const dir = dirname(lockPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const staleMs = Math.max(15_000, Number(process.env.CATALOG_LOCK_STALE_MS ?? 90_000));
  const timeoutMs = Math.max(staleMs, Number(process.env.CATALOG_LOCK_TIMEOUT_MS ?? 180_000));
  const started = Date.now();
  let fd: number | null = null;

  const trySteal = (): void => {
    if (!existsSync(lockPath)) return;
    let steal = false;
    try {
      const age = Date.now() - statSync(lockPath).mtimeMs;
      if (age > staleMs) steal = true;
      else {
        const raw = readFileSync(lockPath, "utf8").trim();
        const pid = Number(raw.split(/\s+/)[0]);
        if (!pidAlive(pid)) steal = true;
      }
    } catch {
      steal = true;
    }
    if (!steal) return;
    try {
      unlinkSync(lockPath);
      console.warn(`[catalog] stole stale lock ${lockPath}`);
    } catch { /* raced */ }
  };

  while (fd == null) {
    try {
      fd = openSync(lockPath, "wx");
      writeFileSync(lockPath, `${process.pid} ${Date.now()}\n`, "utf8");
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "EEXIST") throw e;
      trySteal();
      if (Date.now() - started > timeoutMs) {
        throw new Error(`catalog lock timeout: ${lockPath}`);
      }
      sleepSyncMs(100);
    }
  }
  try {
    fn();
  } finally {
    try { closeSync(fd); } catch { /* ignore */ }
    try { unlinkSync(lockPath); } catch { /* ignore */ }
  }
}

function hearingDateKey(raw: string | undefined): number | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const dmy = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dmy) return Number(dmy[3]) * 10000 + Number(dmy[2]) * 100 + Number(dmy[1]);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return Number(iso[1]) * 10000 + Number(iso[2]) * 100 + Number(iso[3]);
  return null;
}

/** Normalize UI/API date to comparable yyyymmdd, or null. */
export function parseHearingFilterDate(raw: string | undefined): number | null {
  return hearingDateKey(raw);
}

function preferLonger<T>(a: T[] | undefined, b: T[] | undefined): T[] {
  const aa = a ?? [];
  const bb = b ?? [];
  return bb.length > aa.length ? bb : aa;
}

function mergeStoredCase(disk: StoredCase | undefined, local: StoredCase): StoredCase {
  if (!disk) return local;
  const diskEnriched = Boolean(disk.enrichedAt);
  const localEnriched = Boolean(local.enrichedAt);
  const newer =
    localEnriched && (!diskEnriched || (local.enrichedAt ?? "") >= (disk.enrichedAt ?? ""))
      ? local
      : diskEnriched && !localEnriched
        ? disk
        : (local.collectedAt ?? "") >= (disk.collectedAt ?? "")
          ? local
          : disk;
  const older = newer === local ? disk : local;
  const cat = (s?: string) => {
    const t = (s ?? "").trim();
    return t && t !== "—" && t !== "Не указано" && t !== "не указано" ? t : "";
  };
  return {
    ...older,
    ...newer,
    category: cat(newer.category) || cat(older.category) || newer.category || older.category,
    participants: preferLonger(older.participants, newer.participants),
    documents: preferLonger(older.documents, newer.documents),
    events: preferLonger(older.events, newer.events),
    documentsCount: Math.max(older.documentsCount ?? 0, newer.documentsCount ?? 0),
    hasActText: Boolean(older.hasActText || newer.hasActText),
    caseUrl: newer.caseUrl || older.caseUrl,
    enrichedAt: newer.enrichedAt || older.enrichedAt,
    changeLog: mergeChangeLog(older.changeLog, newer.changeLog ?? []),
  };
}

export interface StoredDocument {
  docId: string;
  name: string;
  date?: string;
  caseNumber?: string;
  url?: string;
  text?: string;
  hasText?: boolean;
}

export interface StoredCase {
  id: string;
  caseUid?: string;
  caseNumber: string;
  courtSubdomain: string;
  courtName: string;
  courtRegion?: string;
  category: string;
  parties?: string;
  plaintiff?: string;
  defendant?: string;
  judge?: string;
  status?: string;
  entryDate?: string;
  resultDate?: string;
  hearingDate?: string;
  hearingTime?: string;
  courtroom?: string;
  caseUrl?: string;
  documentsCount: number;
  hasActText: boolean;
  documents: StoredDocument[];
  firstInstance?: {
    court?: string;
    caseNumber?: string;
    judge?: string;
  };
  participants: CaseParticipant[];
  events: CaseEvent[];
  collectedAt: string;
  enrichedAt?: string;
  lastSyncedAt?: string;
  changeLog?: CaseChange[];
}

/** Lightweight row for list endpoints — no documents/events/participants payloads. */
export interface CaseListItem {
  id: string;
  caseUid?: string;
  caseNumber: string;
  courtSubdomain: string;
  courtName: string;
  courtRegion?: string;
  category: string;
  plaintiff?: string;
  defendant?: string;
  judge?: string;
  status?: string;
  hearingDate?: string;
  hearingTime?: string;
  documentsCount: number;
  hasActText: boolean;
  eventsCount: number;
  enrichedAt?: string;
  collectedAt: string;
}

interface StoreShape {
  version: number;
  cases: Record<string, StoredCase>;
}

interface FacetCache {
  courts: Array<{ subdomain: string; name: string; region?: string; count: number }>;
  categories: Array<{ name: string; count: number }>;
  regions: Array<{ region: string; count: number }>;
}

const CATEGORY_GROUP_RULES: Array<{ id: string; test: (n: string) => boolean }> = [
  { id: "civil", test: (n) => /граждан|спор|иск|экон|банкрот|семейн|трудов|жилищ/i.test(n) },
  { id: "criminal", test: (n) => /уголов/i.test(n) },
  { id: "admin", test: (n) => /админ/i.test(n) },
  { id: "appeal", test: (n) => /апелляц|кассац/i.test(n) },
];

function caseId(subdomain: string, item: { caseUid?: string; caseNumber: string }): string {
  return item.caseUid ?? `${subdomain}:${item.caseNumber}`;
}

function splitParties(parties: string): { plaintiff?: string; defendant?: string } {
  if (!parties?.trim()) return {};
  const parts = parties.split(/[;/|]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return { plaintiff: parts[0], defendant: parts[1] };
  return { plaintiff: parties.trim() };
}

function buildSearchHaystack(c: StoredCase): string {
  return [
    c.caseNumber, c.caseUid, c.courtName, c.courtSubdomain, c.courtRegion,
    c.category, c.parties, c.plaintiff, c.defendant, c.judge, c.status,
    ...c.participants.map((p) => p.name),
  ].filter(Boolean).join(" ").toLowerCase();
}

function toListItem(c: StoredCase): CaseListItem {
  return {
    id: c.id,
    caseUid: c.caseUid,
    caseNumber: c.caseNumber,
    courtSubdomain: c.courtSubdomain,
    courtName: c.courtName,
    courtRegion: c.courtRegion,
    category: c.category,
    plaintiff: c.plaintiff,
    defendant: c.defendant,
    judge: c.judge,
    status: c.status,
    hearingDate: c.hearingDate,
    hearingTime: c.hearingTime,
    documentsCount: c.documentsCount || c.documents.length,
    hasActText: c.hasActText,
    eventsCount: c.events.length,
    enrichedAt: c.enrichedAt,
    collectedAt: c.collectedAt,
  };
}

function intersectSets(sets: Set<string>[]): Set<string> | null {
  if (!sets.length) return null;
  const [first, ...rest] = sets;
  if (!first?.size) return new Set();
  const out = new Set<string>();
  for (const id of first) {
    if (rest.every((s) => s.has(id))) out.add(id);
  }
  return out;
}

export class CaseCatalog {
  private cases = new Map<string, StoredCase>();
  private path: string | null = null;
  private dirty = false;
  /** Case ids mutated since last successful flush (for multi-process merge). */
  private dirtyIds = new Set<string>();

  private markDirty(id: string): void {
    this.dirty = true;
    this.dirtyIds.add(id);
  }

  // Read-path indexes (rebuilt lazily when dirty)
  private indexDirty = true;
  private sortedIds: string[] = [];
  private searchHaystack = new Map<string, string>();
  private byCourt = new Map<string, Set<string>>();
  private byRegion = new Map<string, Set<string>>();
  private byCategory = new Map<string, Set<string>>();
  private enrichedIds = new Set<string>();
  private withDocumentsIds = new Set<string>();
  private facetCache: FacetCache | null = null;

  // Incremental enrichment counters (rebuilt on load)
  private enrichPending = 0;
  private enrichWithDocuments = 0;
  private enrichWithActText = 0;

  get size(): number {
    return this.cases.size;
  }

  setPath(p: string): void {
    this.path = p;
  }

  has(id: string): boolean {
    return this.cases.has(id);
  }

  get(id: string): StoredCase | undefined {
    return this.cases.get(id);
  }

  private invalidateIndexes(): void {
    this.indexDirty = true;
    this.facetCache = null;
  }

  private touchEnrichmentStats(prev: StoredCase | undefined, next: StoredCase): void {
    if (prev) {
      if (prev.caseUrl && !prev.enrichedAt) this.enrichPending--;
      if (prev.documentsCount > 0 || prev.documents.length > 0) this.enrichWithDocuments--;
      if (prev.hasActText) this.enrichWithActText--;
    }
    if (next.caseUrl && !next.enrichedAt) this.enrichPending++;
    if (next.documentsCount > 0 || next.documents.length > 0) this.enrichWithDocuments++;
    if (next.hasActText) this.enrichWithActText++;
  }

  private rebuildEnrichmentStats(): void {
    this.enrichPending = 0;
    this.enrichWithDocuments = 0;
    this.enrichWithActText = 0;
    for (const c of this.cases.values()) {
      if (c.caseUrl && !c.enrichedAt) this.enrichPending++;
      if (c.documentsCount > 0 || c.documents.length > 0) this.enrichWithDocuments++;
      if (c.hasActText) this.enrichWithActText++;
    }
  }

  private ensureIndexes(): void {
    if (!this.indexDirty) return;

    this.sortedIds = [];
    this.searchHaystack.clear();
    this.byCourt.clear();
    this.byRegion.clear();
    this.byCategory.clear();
    this.enrichedIds.clear();
    this.withDocumentsIds.clear();

    const rows = [...this.cases.values()];
    rows.sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
    this.sortedIds = rows.map((c) => c.id);

    for (const c of rows) {
      this.searchHaystack.set(c.id, buildSearchHaystack(c));

      const courtSet = this.byCourt.get(c.courtSubdomain) ?? new Set<string>();
      courtSet.add(c.id);
      this.byCourt.set(c.courtSubdomain, courtSet);

      if (c.courtRegion) {
        const regionSet = this.byRegion.get(c.courtRegion) ?? new Set<string>();
        regionSet.add(c.id);
        this.byRegion.set(c.courtRegion, regionSet);
      }

      if (c.category) {
        const catSet = this.byCategory.get(c.category) ?? new Set<string>();
        catSet.add(c.id);
        this.byCategory.set(c.category, catSet);
      }

      if (c.enrichedAt) this.enrichedIds.add(c.id);
      if (c.documentsCount > 0 || c.documents.length > 0 || c.hasActText) {
        this.withDocumentsIds.add(c.id);
      }
    }

    this.facetCache = {
      courts: [...this.byCourt.entries()]
        .map(([subdomain, ids]) => {
          const sample = this.cases.get([...ids][0]!);
          return {
            subdomain,
            name: sample?.courtName ?? subdomain,
            region: sample?.courtRegion,
            count: ids.size,
          };
        })
        .sort((a, b) => b.count - a.count),
      categories: [...this.byCategory.entries()]
        .map(([name, ids]) => ({ name, count: ids.size }))
        .sort((a, b) => b.count - a.count),
      regions: [...this.byRegion.entries()]
        .map(([region, ids]) => ({ region, count: ids.size }))
        .sort((a, b) => b.count - a.count),
    };

    this.indexDirty = false;
  }

  // Fast ingest from hearing schedule — no network beyond schedule fetch.
  upsertFromHearing(court: CourtEntry, item: HearingItem): boolean {
    if (!item.caseNumber) return false;
    const id = caseId(court.subdomain, item);
    const existing = this.cases.get(id);
    const { plaintiff, defendant } = splitParties(item.parties);

    const row: StoredCase = {
      id,
      caseUid: item.caseUid,
      caseNumber: item.caseNumber,
      courtSubdomain: court.subdomain,
      courtName: court.name,
      courtRegion: court.region,
      category: item.category || existing?.category || "Не указано",
      parties: item.parties || existing?.parties,
      plaintiff: plaintiff ?? existing?.plaintiff,
      defendant: defendant ?? existing?.defendant,
      judge: item.judge || existing?.judge,
      status: existing?.status ?? "Заседание",
      entryDate: existing?.entryDate,
      resultDate: existing?.resultDate,
      hearingDate: item.hearingDate || existing?.hearingDate,
      hearingTime: item.hearingTime || existing?.hearingTime,
      courtroom: item.courtroom || existing?.courtroom,
      caseUrl: item.caseUrl || existing?.caseUrl,
      documentsCount: existing?.documentsCount ?? 0,
      hasActText: existing?.hasActText ?? false,
      documents: existing?.documents ?? [],
      firstInstance: existing?.firstInstance,
      participants: existing?.participants ?? [],
      events: existing?.events ?? [],
      collectedAt: existing?.collectedAt ?? new Date().toISOString(),
      enrichedAt: existing?.enrichedAt,
    };

    const isNew = !existing;
    this.touchEnrichmentStats(existing, row);
    this.cases.set(id, row);
    this.markDirty(id);
    this.invalidateIndexes();
    return isNew;
  }

  /** Ingest from Tier-2 extended search results. */
  upsertFromSearchResult(court: CourtEntry, item: CaseSearchResult): boolean {
    if (!item.caseNumber) return false;
    const id = caseId(court.subdomain, item);
    const existing = this.cases.get(id);

    const row: StoredCase = {
      id,
      caseUid: item.caseUid ?? existing?.caseUid,
      caseNumber: item.caseNumber,
      courtSubdomain: court.subdomain,
      courtName: court.name,
      courtRegion: court.region,
      category: item.category || existing?.category || "Не указано",
      plaintiff: item.plaintiff ?? existing?.plaintiff,
      defendant: item.defendant ?? existing?.defendant,
      judge: item.judge ?? existing?.judge,
      status: item.status ?? existing?.status,
      entryDate: item.entryDate ?? existing?.entryDate,
      resultDate: item.resultDate ?? existing?.resultDate,
      hearingDate: existing?.hearingDate,
      hearingTime: existing?.hearingTime,
      courtroom: existing?.courtroom,
      caseUrl: item.caseUrl ?? existing?.caseUrl,
      documentsCount: existing?.documentsCount ?? 0,
      hasActText: existing?.hasActText ?? false,
      documents: existing?.documents ?? [],
      firstInstance: existing?.firstInstance,
      participants: existing?.participants ?? [],
      events: existing?.events ?? [],
      collectedAt: existing?.collectedAt ?? new Date().toISOString(),
      enrichedAt: existing?.enrichedAt,
    };

    const isNew = !existing;
    this.touchEnrichmentStats(existing, row);
    this.cases.set(id, row);
    this.markDirty(id);
    this.invalidateIndexes();
    return isNew;
  }

  // Enrich from full case card (optional slow path).
  enrichFromDetails(id: string, details: CaseDetails, hasActText = false): CaseChange[] {
    const existing = this.cases.get(id);
    if (!existing) return [];

    const changes = existing.enrichedAt ? diffCase(existing, details) : [];

    const row: StoredCase = {
      ...existing,
      caseUid: details.caseUid ?? existing.caseUid,
      caseNumber: details.caseNumber || existing.caseNumber,
      category: details.category || existing.category,
      plaintiff: details.plaintiff ?? existing.plaintiff,
      defendant: details.defendant ?? existing.defendant,
      judge: details.judge ?? existing.judge,
      status: details.status ?? existing.status,
      entryDate: details.entryDate ?? existing.entryDate,
      resultDate: details.resultDate ?? existing.resultDate,
      caseUrl: details.caseUrl ?? existing.caseUrl,
      documentsCount: details.documents?.length ?? 0,
      hasActText: hasActText || existing.hasActText,
      documents: (details.documents ?? []).map((d) => {
        const hasText = Boolean(d.text?.trim()) || Boolean(
          existing.documents?.find((x) => x.docId === d.docId)?.hasText
          || existing.documents?.find((x) => x.docId === d.docId)?.text,
        );
        return {
          docId: d.docId,
          name: d.name,
          date: d.date,
          caseNumber: d.caseNumber,
          url: d.url,
          // Act bodies live in RAG — catalog stays lean for 50k–200k cases.
          text: catalogStoresActText() && d.text?.trim() ? d.text : undefined,
          hasText,
        };
      }),
      firstInstance: details.firstInstance ?? existing.firstInstance,
      participants: (details.participants?.length ?? 0) ? details.participants! : existing.participants,
      events: (details.events?.length ?? 0) ? details.events!.slice(0, 30) : existing.events,
      enrichedAt: new Date().toISOString(),
      lastSyncedAt: new Date().toISOString(),
      changeLog: mergeChangeLog(existing.changeLog, changes),
    };

    this.touchEnrichmentStats(existing, row);
    this.cases.set(id, row);
    this.markDirty(id);
    this.invalidateIndexes();
    return changes;
  }

  markHasActText(id: string): void {
    const c = this.cases.get(id);
    if (!c || c.hasActText) return;
    c.hasActText = true;
    this.enrichWithActText++;
    this.markDirty(id);
    this.invalidateIndexes();
  }

  /** Drop act bodies from all cases (disk stays lean; RAG keeps full text). */
  compactActTexts(): number {
    let n = 0;
    for (const [id, c] of this.cases) {
      const lean = stripDocumentTexts(c);
      if (lean === c) continue;
      this.cases.set(id, lean);
      this.markDirty(id);
      n++;
    }
    if (n) this.invalidateIndexes();
    return n;
  }

  private candidateIds(opts: {
    court?: string;
    region?: string;
    category?: string;
    hasDocuments?: boolean;
    enriched?: boolean;
  }): Set<string> | null {
    const sets: Set<string>[] = [];

    if (opts.court && opts.court !== "all") {
      const courtIds = this.byCourt.get(opts.court);
      if (!courtIds?.size) return new Set();
      sets.push(courtIds);
    }
    if (opts.region && opts.region !== "all") {
      const regionIds = this.byRegion.get(opts.region);
      if (!regionIds?.size) return new Set();
      sets.push(regionIds);
    }
    if (opts.category && opts.category !== "all") {
      const matching = new Set<string>();
      for (const [name, ids] of this.byCategory) {
        if (name.includes(opts.category!)) {
          for (const id of ids) matching.add(id);
        }
      }
      if (!matching.size) return new Set();
      sets.push(matching);
    }
    if (opts.hasDocuments) sets.push(this.withDocumentsIds);
    if (opts.enriched) sets.push(this.enrichedIds);

    return sets.length ? intersectSets(sets) : null;
  }

  private passesTextFilters(
    c: StoredCase,
    opts: {
      q?: string;
      caseNumber?: string;
      uid?: string;
      participant?: string;
      /** Role family or raw role: representative / ПРЕДСТАВИТЕЛЬ / истец / … */
      participantRole?: string;
      judge?: string;
      court?: string;
      region?: string;
      categoryGroup?: string;
    },
  ): boolean {
    const match = (value: string | undefined, needle: string) =>
      (value ?? "").toLowerCase().includes(needle.toLowerCase());

    const q = opts.q?.trim().toLowerCase();
    if (q && !this.searchHaystack.get(c.id)?.includes(q)) return false;

    const caseNumber = opts.caseNumber?.trim();
    if (caseNumber && !match(c.caseNumber, caseNumber)) return false;

    const uid = opts.uid?.trim();
    if (uid && !match(c.caseUid, uid)) return false;

    const participant = opts.participant?.trim();
    const participantRole = opts.participantRole?.trim();
    if (participant || (participantRole && participantRole !== "all")) {
      // Lazy import avoided — inline role match (mirrors participants/aggregate)
      const roleOk = (role: string): boolean => {
        if (!participantRole || participantRole === "all") return true;
        const f = participantRole.toLowerCase();
        const r = role.toLowerCase();
        if (f === "representative" || f === "представитель" || f === "представ" || f === "rep") {
          return /представ|адвокат|защитник|юрисконсульт/.test(r);
        }
        if (f === "plaintiff" || f === "истец") return /истец|заявител|взыскател|кредитор/.test(r);
        if (f === "defendant" || f === "ответчик") return /ответчик|должник|обвиняем|подсудим/.test(r);
        if (f === "third" || f === "третье") return /треть/.test(r);
        if (f === "judge" || f === "судья") return /судья|председ/.test(r);
        return r.includes(f);
      };
      const nameOk = (n?: string) => !participant || match(n, participant);
      let ok = c.participants.some((p) => nameOk(p.name) && roleOk(p.role || ""));
      if (!ok && (!participantRole || participantRole === "all" || roleOk("ИСТЕЦ"))) {
        ok = nameOk(c.plaintiff);
      }
      if (!ok && (!participantRole || participantRole === "all" || roleOk("ОТВЕТЧИК"))) {
        ok = nameOk(c.defendant);
      }
      if (!ok && (!participantRole || participantRole === "all")) {
        ok = nameOk(c.parties) || nameOk(c.judge);
      }
      // Role-only filter: any participant with that role
      if (!ok && !participant && participantRole && participantRole !== "all") {
        ok = c.participants.some((p) => roleOk(p.role || ""));
        if (!ok && roleOk("ИСТЕЦ") && (c.plaintiff ?? "").trim()) ok = true;
        if (!ok && roleOk("ОТВЕТЧИК") && (c.defendant ?? "").trim()) ok = true;
        if (!ok && roleOk("СУДЬЯ") && (c.judge ?? "").trim()) ok = true;
      }
      if (!ok) return false;
    }

    const judge = opts.judge?.trim();
    if (judge && !match(c.judge, judge)) return false;

    if (opts.court && opts.court !== "all") {
      if (c.courtSubdomain !== opts.court && !c.courtName.includes(opts.court)) return false;
    }
    if (opts.region && opts.region !== "all") {
      if (c.courtRegion !== opts.region && !match(c.courtRegion, opts.region)) return false;
    }

    if (opts.categoryGroup && opts.categoryGroup !== "all") {
      const gid = opts.categoryGroup;
      if (gid === "other") {
        if (CATEGORY_GROUP_RULES.some((r) => r.test(c.category))) return false;
      } else {
        const rule = CATEGORY_GROUP_RULES.find((r) => r.id === gid);
        if (rule && !rule.test(c.category)) return false;
      }
    }

    return true;
  }

  list(opts: {
    q?: string;
    caseNumber?: string;
    uid?: string;
    participant?: string;
    participantRole?: string;
    judge?: string;
    court?: string;
    region?: string;
    category?: string;
    categoryGroup?: string;
    hasDocuments?: boolean;
    enriched?: boolean;
    /** Inclusive hearing date lower bound (DD.MM.YYYY or YYYY-MM-DD). */
    hearingFrom?: string;
    /** Inclusive hearing date upper bound (DD.MM.YYYY or YYYY-MM-DD). */
    hearingTo?: string;
    limit?: number;
    offset?: number;
    /** Return full StoredCase rows (default: slim CaseListItem). */
    full?: boolean;
  } = {}): { total: number; cases: StoredCase[] | CaseListItem[] } {
    this.ensureIndexes();

    const offset = opts.offset ?? 0;
    const limit = Math.min(opts.limit ?? 50, 100);
    const hearingFromKey = parseHearingFilterDate(opts.hearingFrom);
    const hearingToKey = parseHearingFilterDate(opts.hearingTo);
    const hasHearingFilter = hearingFromKey != null || hearingToKey != null;
    const hasTextFilters = Boolean(
      opts.q?.trim()
      || opts.caseNumber?.trim()
      || opts.uid?.trim()
      || opts.participant?.trim()
      || (opts.participantRole?.trim() && opts.participantRole !== "all")
      || opts.judge?.trim()
      || (opts.categoryGroup && opts.categoryGroup !== "all"),
    );

    const indexed = this.candidateIds(opts);
    if (indexed && indexed.size === 0) return { total: 0, cases: [] };

    const browseAll =
      !indexed
      && !hasTextFilters
      && !hasHearingFilter
      && !(opts.court && opts.court !== "all")
      && !(opts.region && opts.region !== "all")
      && !(opts.category && opts.category !== "all")
      && !opts.hasDocuments
      && !opts.enriched;

    if (browseAll) {
      const total = this.sortedIds.length;
      const slice = this.sortedIds.slice(offset, offset + limit);
      const cases = opts.full
        ? slice.map((id) => this.cases.get(id)!)
        : slice.map((id) => toListItem(this.cases.get(id)!));
      return { total, cases };
    }

    const passesHearing = (c: StoredCase): boolean => {
      if (!hasHearingFilter) return true;
      const key = hearingDateKey(c.hearingDate);
      if (key == null) return false;
      if (hearingFromKey != null && key < hearingFromKey) return false;
      if (hearingToKey != null && key > hearingToKey) return false;
      return true;
    };

    // Stream over sortedIds (already collectedAt desc) — never materialize all matches.
    // Fast path: pure set filters already encoded in `indexed` → total = set size,
    // stop after filling the page (no full 70k walk).
    if (
      indexed
      && !hasTextFilters
      && !hasHearingFilter
      && !(opts.categoryGroup && opts.categoryGroup !== "all")
    ) {
      const total = indexed.size;
      const pageIds: string[] = [];
      let skipped = 0;
      for (const id of this.sortedIds) {
        if (!indexed.has(id)) continue;
        if (skipped < offset) {
          skipped++;
          continue;
        }
        pageIds.push(id);
        if (pageIds.length >= limit) break;
      }
      const cases = opts.full
        ? pageIds.map((id) => this.cases.get(id)!)
        : pageIds.map((id) => toListItem(this.cases.get(id)!));
      return { total, cases };
    }

    const pageIds: string[] = [];
    let total = 0;
    for (const id of this.sortedIds) {
      if (indexed && !indexed.has(id)) continue;
      const c = this.cases.get(id);
      if (!c) continue;
      if (!this.passesTextFilters(c, opts)) continue;
      if (!passesHearing(c)) continue;
      if (opts.hasDocuments && !(c.documentsCount > 0 || c.documents.length > 0 || c.hasActText)) continue;
      if (opts.enriched && !c.enrichedAt) continue;
      if (opts.category && opts.category !== "all" && !c.category.includes(opts.category)) continue;
      if (total >= offset && pageIds.length < limit) pageIds.push(id);
      total++;
    }

    const cases = opts.full
      ? pageIds.map((id) => this.cases.get(id)!)
      : pageIds.map((id) => toListItem(this.cases.get(id)!));
    return { total, cases };
  }

  courts(): Array<{ subdomain: string; name: string; region?: string; count: number }> {
    this.ensureIndexes();
    return this.facetCache!.courts;
  }

  categories(): string[] {
    return this.categoryFacets().map((c) => c.name);
  }

  categoryFacets(): Array<{ name: string; count: number }> {
    this.ensureIndexes();
    return this.facetCache!.categories;
  }

  regions(): Array<{ region: string; count: number }> {
    this.ensureIndexes();
    return this.facetCache!.regions;
  }

  save(path?: string): void {
    const p = path ?? this.path;
    if (!p) return;
    const lean = !catalogStoresActText();
    const casesObj: Record<string, StoredCase> = {};
    for (const [id, c] of this.cases) {
      casesObj[id] = lean ? stripDocumentTexts(c) : c;
    }
    const payload: StoreShape = { version: 1, cases: casesObj };
    const json = JSON.stringify(payload);
    // Cheap integrity check — full JSON.parse of 70k catalog under lock freezes peers.
    if (!json.startsWith("{") || !json.endsWith("}") || json.length < 20) {
      throw new Error("catalog save produced invalid JSON payload");
    }

    const dir = dirname(p);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${p}.tmp`;
    const bak = `${p}.bak`;
    writeFileSync(tmp, json, "utf8");
    if (existsSync(p) && process.env.CATALOG_SKIP_BAK !== "1") {
      try { copyFileSync(p, bak); } catch { /* ignore bak failures */ }
    }
    // copyFile overwrites on Windows; renameSync often cannot replace existing.
    copyFileSync(tmp, p);
    try { unlinkSync(tmp); } catch { /* ignore */ }
    this.dirty = false;
    this.dirtyIds.clear();
    this.lastLoadMtime = existsSync(p) ? statSync(p).mtimeMs : 0;
  }

  private lastLoadMtime = 0;

  /** Reload from disk if another process (Go parser-worker) updated the file. */
  reloadIfChanged(): boolean {
    const p = this.path;
    if (!p || !existsSync(p)) return false;
    const mtime = statSync(p).mtimeMs;
    if (mtime <= this.lastLoadMtime) return false;
    try {
      this.load(p);
      return true;
    } catch (e) {
      console.error(
        `[catalog] corrupt store on reload, keeping memory: ${e instanceof Error ? e.message : e}`,
      );
      return false;
    }
  }

  load(path: string): void {
    if (!existsSync(path)) return;
    let data: StoreShape;
    try {
      data = JSON.parse(readFileSync(path, "utf8")) as StoreShape;
    } catch (e) {
      const bak = `${path}.bak`;
      if (existsSync(bak) && bak !== path) {
        console.error(
          `[catalog] ${path} unreadable (${e instanceof Error ? e.message : e}), trying .bak`,
        );
        this.load(bak);
        this.path = path;
        return;
      }
      throw e;
    }
    this.cases.clear();
    for (const [id, c] of Object.entries(data.cases ?? {})) {
      this.cases.set(id, {
        ...c,
        documents: c.documents ?? [],
        participants: c.participants ?? [],
        events: c.events ?? [],
        changeLog: c.changeLog ?? [],
      });
    }
    this.path = path;
    this.dirty = false;
    this.dirtyIds.clear();
    this.lastLoadMtime = existsSync(path) ? statSync(path).mtimeMs : 0;
    this.invalidateIndexes();
    this.rebuildEnrichmentStats();
  }

  private saveIfPath(): void {
    if (this.path && this.dirty) this.flush();
  }

  /**
   * Persist dirty cases under a file lock, merging with concurrent writers
   * (reparse + schedule vacuum).
   */
  flush(): void {
    const p = this.path;
    if (!this.dirty || !p) return;

    const pending = new Map<string, StoredCase>();
    for (const id of this.dirtyIds) {
      const c = this.cases.get(id);
      if (c) pending.set(id, structuredClone(c));
    }
    // Fallback: if dirty flag set without ids, save whole map (single-writer path)
    if (!pending.size) {
      withCatalogFileLock(p, () => this.save(p));
      return;
    }

    const singleWriter = process.env.CATALOG_SINGLE_WRITER === "1";

    withCatalogFileLock(p, () => {
      if (!singleWriter && existsSync(p)) {
        const mtime = statSync(p).mtimeMs;
        if (mtime > this.lastLoadMtime) {
          try {
            this.load(p);
          } catch (e) {
            console.error(
              `[catalog] corrupt on-disk store during flush — rewriting from memory: ${
                e instanceof Error ? e.message : e
              }`,
            );
          }
        }
      }
      for (const [id, local] of pending) {
        const merged = mergeStoredCase(this.cases.get(id), local);
        this.touchEnrichmentStats(this.cases.get(id), merged);
        this.cases.set(id, merged);
      }
      this.save(p);
    });
  }

  /** Count cases awaiting document enrich (optionally by courtRegion). */
  countPendingEnrichment(opts?: { region?: string }): number {
    this.ensureIndexes();
    const region = opts?.region?.trim();
    const ids = region ? this.byRegion.get(region) : undefined;
    let n = 0;
    const scan = (iter: Iterable<string>) => {
      for (const id of iter) {
        const c = this.cases.get(id);
        if (c?.caseUrl && !c.enrichedAt) n++;
      }
    };
    if (ids?.size) scan(ids);
    else if (!region) scan(this.sortedIds);
    return n;
  }

  /** Cases with a card URL but not yet fetched (documents, events, participants). */
  listPendingEnrichment(limit = 20, opts?: { region?: string }): StoredCase[] {
    this.ensureIndexes();

    const pick = (ids: Iterable<string>): StoredCase[] => {
      const rows: StoredCase[] = [];
      for (const id of ids) {
        const c = this.cases.get(id);
        if (c?.caseUrl && !c.enrichedAt) rows.push(c);
      }
      rows.sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
      return rows.slice(0, limit);
    };

    const region = opts?.region?.trim();
    if (region) {
      const regionIds = this.byRegion.get(region);
      if (regionIds?.size) return pick(regionIds);
      return [];
    }

    return pick(this.sortedIds);
  }

  forEach(fn: (c: StoredCase) => void): void {
    for (const c of this.cases.values()) fn(c);
  }

  enrichmentStats(): { pending: number; withDocuments: number; withActText: number } {
    return {
      pending: this.enrichPending,
      withDocuments: this.enrichWithDocuments,
      withActText: this.enrichWithActText,
    };
  }
}
