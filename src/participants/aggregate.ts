// Index ALL case participants (истец / ответчик / ПРЕДСТАВИТЕЛЬ / …) independently
// of the lawyer/judge FIFA cards.

import type { CaseCatalog, StoredCase } from "../cases/store.js";
import { isDepersonalizedMarker } from "../analytics/person-name.js";
import { classifyOutcome, type OutcomeLabel } from "../analytics/outcome.js";
import { parseRuDate } from "../analytics/deep-analytics.js";

export type ParticipantRoleFamily =
  | "representative"
  | "plaintiff"
  | "defendant"
  | "third"
  | "judge"
  | "other";

export const ROLE_FAMILY_LABELS: Record<ParticipantRoleFamily, string> = {
  representative: "ПРЕДСТАВИТЕЛЬ",
  plaintiff: "ИСТЕЦ",
  defendant: "ОТВЕТЧИК",
  third: "ТРЕТЬЕ ЛИЦО",
  judge: "СУДЬЯ",
  other: "ПРОЧЕЕ",
};

export interface ParticipantPerson {
  id: string;
  name: string;
  /** Raw roles seen on cards */
  roles: string[];
  /** Canonical families */
  families: ParticipantRoleFamily[];
  primaryFamily: ParticipantRoleFamily;
  cases: number;
  courts: number;
  withActs: number;
  enrichedCases: number;
  sampleCaseNumbers: string[];
  sampleCourts: string[];
}

export interface ParticipantRoleFacet {
  family: ParticipantRoleFamily;
  label: string;
  people: number;
  appearances: number;
}

interface Acc {
  name: string;
  roles: Set<string>;
  families: Set<ParticipantRoleFamily>;
  caseIds: Set<string>;
  courts: Set<string>;
  withActs: number;
  enriched: number;
  samples: string[];
  sampleCourts: string[];
}

const SKIP = /^(не указ|неизвест|нет данных|информация скрыта|фио#?|—|-|\.{2,})$/i;

let cache: { catalogSize: number; people: ParticipantPerson[]; facets: ParticipantRoleFacet[] } | null = null;

export function classifyRoleFamily(role: string): ParticipantRoleFamily {
  const r = role.toLowerCase();
  if (/судья|председ/.test(r)) return "judge";
  if (/представ|адвокат|защитник|юрист/.test(r)) return "representative";
  if (/истец|заявител|взыскател|кредитор/.test(r)) return "plaintiff";
  if (/ответчик|должник|обвиняем|подсудим/.test(r)) return "defendant";
  if (/треть/.test(r)) return "third";
  return "other";
}

/** Match family filter: canonical id, Russian label, or raw role substring. */
export function roleMatchesFilter(role: string, filter: string): boolean {
  const f = filter.trim().toLowerCase();
  if (!f || f === "all" || f === "*") return true;
  const fam = classifyRoleFamily(role);
  if (f === fam) return true;
  if (f === ROLE_FAMILY_LABELS[fam].toLowerCase()) return true;
  // aliases
  if ((f === "представитель" || f === "представ" || f === "rep") && fam === "representative") return true;
  if ((f === "истец" || f === "plaintiff") && fam === "plaintiff") return true;
  if ((f === "ответчик" || f === "defendant") && fam === "defendant") return true;
  return role.toLowerCase().includes(f);
}

export function familyMatchesFilter(family: ParticipantRoleFamily, filter: string): boolean {
  return roleMatchesFilter(ROLE_FAMILY_LABELS[family], filter)
    || roleMatchesFilter(family, filter);
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function cleanName(raw: string): string | null {
  const n = raw.replace(/\s+/g, " ").trim();
  if (isDepersonalizedMarker(n) || n.length < 2 || SKIP.test(n)) return null;
  if (/^\d+$/.test(n)) return null;
  return n;
}

function primaryFamily(families: Set<ParticipantRoleFamily>): ParticipantRoleFamily {
  const order: ParticipantRoleFamily[] = [
    "representative", "plaintiff", "defendant", "third", "judge", "other",
  ];
  for (const f of order) if (families.has(f)) return f;
  return "other";
}

function touch(
  map: Map<string, Acc>,
  name: string,
  roleRaw: string,
  family: ParticipantRoleFamily,
  c: StoredCase,
): void {
  const key = name.toLowerCase();
  let a = map.get(key);
  if (!a) {
    a = {
      name,
      roles: new Set(),
      families: new Set(),
      caseIds: new Set(),
      courts: new Set(),
      withActs: 0,
      enriched: 0,
      samples: [],
      sampleCourts: [],
    };
    map.set(key, a);
  }
  if (roleRaw) a.roles.add(roleRaw.replace(/\s+/g, " ").trim());
  a.families.add(family);
  if (!a.caseIds.has(c.id)) {
    a.caseIds.add(c.id);
    if (c.hasActText) a.withActs++;
    if (c.enrichedAt) a.enriched++;
    if (a.samples.length < 5) a.samples.push(c.caseNumber);
    if (a.sampleCourts.length < 4 && !a.sampleCourts.includes(c.courtSubdomain)) {
      a.sampleCourts.push(c.courtSubdomain);
    }
  }
  a.courts.add(c.courtSubdomain);
}

function buildUncached(catalog: CaseCatalog): {
  people: ParticipantPerson[];
  facets: ParticipantRoleFacet[];
} {
  const map = new Map<string, Acc>();
  const appearanceByFamily = new Map<ParticipantRoleFamily, number>();
  const bump = (f: ParticipantRoleFamily) =>
    appearanceByFamily.set(f, (appearanceByFamily.get(f) ?? 0) + 1);

  catalog.forEach((c) => {
    for (const p of c.participants ?? []) {
      const name = cleanName(p.name);
      if (!name) continue;
      const fam = classifyRoleFamily(p.role || "");
      bump(fam);
      touch(map, name, p.role || "?", fam, c);
    }
    // Synthetic from flat fields when cont4 empty / incomplete
    const pl = cleanName(c.plaintiff ?? "");
    if (pl) {
      bump("plaintiff");
      touch(map, pl, "ИСТЕЦ", "plaintiff", c);
    }
    const def = cleanName(c.defendant ?? "");
    if (def) {
      bump("defendant");
      touch(map, def, "ОТВЕТЧИК", "defendant", c);
    }
    const j = cleanName(c.judge ?? "");
    if (j) {
      bump("judge");
      touch(map, j, "СУДЬЯ", "judge", c);
    }
  });

  const people: ParticipantPerson[] = [...map.values()]
    .map((a) => ({
      id: `p:${slug(a.name)}`,
      name: a.name,
      roles: [...a.roles].sort(),
      families: [...a.families],
      primaryFamily: primaryFamily(a.families),
      cases: a.caseIds.size,
      courts: a.courts.size,
      withActs: a.withActs,
      enrichedCases: a.enriched,
      sampleCaseNumbers: a.samples,
      sampleCourts: a.sampleCourts,
    }))
    .sort((a, b) => b.cases - a.cases || a.name.localeCompare(b.name, "ru"));

  const peopleByFamily = new Map<ParticipantRoleFamily, number>();
  for (const p of people) {
    for (const f of p.families) {
      peopleByFamily.set(f, (peopleByFamily.get(f) ?? 0) + 1);
    }
  }

  const facets: ParticipantRoleFacet[] = (
    Object.keys(ROLE_FAMILY_LABELS) as ParticipantRoleFamily[]
  ).map((family) => ({
    family,
    label: ROLE_FAMILY_LABELS[family],
    people: peopleByFamily.get(family) ?? 0,
    appearances: appearanceByFamily.get(family) ?? 0,
  }));

  return { people, facets };
}

export function warmParticipantIndex(catalog: CaseCatalog): void {
  if (cache?.catalogSize === catalog.size) return;
  const t0 = Date.now();
  const built = buildUncached(catalog);
  cache = { catalogSize: catalog.size, ...built };
  console.log(
    `[participants] index: ${built.people.length} people, ` +
      `rep=${built.facets.find((f) => f.family === "representative")?.people ?? 0} in ${Date.now() - t0}ms`,
  );
}

export function listParticipants(
  catalog: CaseCatalog,
  opts: {
    q?: string;
    role?: string;
    limit?: number;
    offset?: number;
    minCases?: number;
  } = {},
): {
  total: number;
  indexReady: boolean;
  facets: ParticipantRoleFacet[];
  people: ParticipantPerson[];
} {
  if (!cache || cache.catalogSize !== catalog.size) warmParticipantIndex(catalog);
  const q = opts.q?.trim().toLowerCase();
  const role = opts.role?.trim() || "all";
  const minCases = opts.minCases ?? 1;
  const offset = opts.offset ?? 0;
  const limit = Math.min(Math.max(opts.limit ?? 48, 1), 200);

  let rows = cache!.people.filter((p) => p.cases >= minCases);
  if (role !== "all") {
    rows = rows.filter((p) =>
      p.families.some((f) => familyMatchesFilter(f, role))
      || p.roles.some((r) => roleMatchesFilter(r, role)),
    );
  }
  if (q) {
    rows = rows.filter((p) => p.name.toLowerCase().includes(q));
  }

  return {
    total: rows.length,
    indexReady: true,
    facets: cache!.facets,
    people: rows.slice(offset, offset + limit),
  };
}

export function getParticipant(
  catalog: CaseCatalog,
  id: string,
): ParticipantPerson | null {
  if (!cache || cache.catalogSize !== catalog.size) warmParticipantIndex(catalog);
  return cache!.people.find((p) => p.id === id) ?? null;
}

export function findParticipantByName(
  catalog: CaseCatalog,
  name: string,
): ParticipantPerson | null {
  if (!cache || cache.catalogSize !== catalog.size) warmParticipantIndex(catalog);
  const key = name.replace(/\s+/g, " ").trim().toLowerCase();
  if (!key || isDepersonalizedMarker(key) || SKIP.test(key)) return null;
  return (
    cache!.people.find((p) => p.name.toLowerCase() === key)
    ?? cache!.people.find((p) => p.name.toLowerCase().includes(key) || key.includes(p.name.toLowerCase()))
    ?? null
  );
}

export interface ParticipantCaseRow {
  id: string;
  caseNumber: string;
  courtSubdomain: string;
  courtName: string;
  category: string;
  status?: string;
  roleOnCase: string;
  hasActText: boolean;
  enriched: boolean;
  outcome: OutcomeLabel;
  entryDate?: string;
  resultDate?: string;
  judge?: string;
}

export interface ParticipantDossier {
  person: ParticipantPerson;
  rating: number;
  tier: "gold" | "silver" | "bronze" | "common";
  roleLabel: string;
  stats: {
    cases: number;
    courts: number;
    withActs: number;
    enrichedCases: number;
    knownOutcomes: number;
    wins: number;
    losses: number;
    neutrals: number;
    winRate: number | null;
    medianDays: number | null;
  };
  outcomes: Record<string, number>;
  byCourt: Array<{ subdomain: string; name: string; count: number }>;
  byCategory: Array<{ name: string; count: number }>;
  byYear: Array<{ year: string; count: number }>;
  /** Cases by federal subject — for Russia heat map */
  geoHeat: Array<{ region: string; label: string; cases: number }>;
  ratingFactors: Array<{ key: string; label: string; score: number; max: number }>;
  cases: ParticipantCaseRow[];
  caveat: string;
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function roleOnCase(c: StoredCase, nameLower: string): string {
  for (const p of c.participants ?? []) {
    if ((p.name ?? "").toLowerCase().includes(nameLower) || nameLower.includes((p.name ?? "").toLowerCase())) {
      return (p.role || "?").trim();
    }
  }
  if ((c.plaintiff ?? "").toLowerCase().includes(nameLower)) return "ИСТЕЦ";
  if ((c.defendant ?? "").toLowerCase().includes(nameLower)) return "ОТВЕТЧИК";
  if ((c.judge ?? "").toLowerCase().includes(nameLower)) return "СУДЬЯ";
  return "?";
}

function tierFrom(cases: number, winRate: number | null): ParticipantDossier["tier"] {
  if (cases >= 20 && (winRate ?? 0) >= 0.55) return "gold";
  if (cases >= 10) return "silver";
  if (cases >= 4) return "bronze";
  return "common";
}

function ratingFrom(cases: number, winRate: number | null, withActs: number): number {
  const base = Math.min(90, 40 + cases * 2 + withActs);
  const wr = winRate != null ? Math.round(winRate * 20) : 0;
  return Math.min(99, base + wr);
}

/** Full dossier for click-through from case card / participants search. */
export function buildParticipantDossier(
  catalog: CaseCatalog,
  opts: { id?: string; name?: string; role?: string; caseLimit?: number },
): ParticipantDossier | null {
  warmParticipantIndex(catalog);
  const person =
    (opts.id ? getParticipant(catalog, opts.id) : null)
    ?? (opts.name ? findParticipantByName(catalog, opts.name) : null);
  if (!person) return null;

  const nameLower = person.name.toLowerCase();
  const roleFilter = opts.role?.trim() || "all";
  const caseLimit = Math.min(opts.caseLimit ?? 80, 200);

  const matched: StoredCase[] = [];
  catalog.forEach((c) => {
    if (caseHasParticipant(c, nameLower, roleFilter === "all" ? undefined : roleFilter)) {
      matched.push(c);
    }
  });
  matched.sort((a, b) => (b.enrichedAt ?? b.collectedAt).localeCompare(a.enrichedAt ?? a.collectedAt));

  const outcomes: Record<string, number> = {};
  let wins = 0, losses = 0, neutrals = 0, known = 0;
  const courtMap = new Map<string, { subdomain: string; name: string; count: number }>();
  const catMap = new Map<string, number>();
  const yearMap = new Map<string, number>();
  const regionMap = new Map<string, number>();
  const durations: number[] = [];

  const rows: ParticipantCaseRow[] = [];
  for (const c of matched) {
    const label = classifyOutcome({
      status: c.status,
      events: c.events,
      documentText: c.documents.map((d) => d.text ?? "").join("\n"),
    }).label;
    outcomes[label] = (outcomes[label] ?? 0) + 1;
    if (label !== "unknown") {
      known++;
      if (label === "granted" || label === "granted_partial") wins++;
      else if (label === "denied") losses++;
      else neutrals++;
    }

    const cm = courtMap.get(c.courtSubdomain) ?? {
      subdomain: c.courtSubdomain,
      name: c.courtName,
      count: 0,
    };
    cm.count++;
    courtMap.set(c.courtSubdomain, cm);

    const regionCode = c.courtRegion || (/--mor$/i.test(c.courtSubdomain) ? "13" : "");
    if (regionCode) regionMap.set(regionCode, (regionMap.get(regionCode) ?? 0) + 1);

    const cat = (c.category || "—").split("→")[0]!.trim().slice(0, 80);
    catMap.set(cat, (catMap.get(cat) ?? 0) + 1);

    const y =
      parseRuDate(c.entryDate)?.getFullYear()?.toString()
      ?? c.caseNumber.match(/\/(20\d{2})/)?.[1];
    if (y) yearMap.set(y, (yearMap.get(y) ?? 0) + 1);

    const start = parseRuDate(c.entryDate);
    const end = parseRuDate(c.resultDate);
    if (start && end) {
      const d = Math.round((end.getTime() - start.getTime()) / 86_400_000);
      if (d >= 0 && d < 4000) durations.push(d);
    }

    if (rows.length < caseLimit) {
      rows.push({
        id: c.id,
        caseNumber: c.caseNumber,
        courtSubdomain: c.courtSubdomain,
        courtName: c.courtName,
        category: cat,
        status: c.status,
        roleOnCase: roleOnCase(c, nameLower),
        hasActText: c.hasActText,
        enriched: Boolean(c.enrichedAt),
        outcome: label,
        entryDate: c.entryDate,
        resultDate: c.resultDate,
        judge: c.judge,
      });
    }
  }

  const decided = wins + losses;
  const winRate = decided > 0 ? wins / decided : null;
  const withActsN = matched.filter((c) => c.hasActText).length;
  const enrichedN = matched.filter((c) => c.enrichedAt).length;
  const rating = ratingFrom(matched.length, winRate, withActsN);
  const REGION_NAMES: Record<string, string> = { "13": "Мордовия" };

  const ratingFactors = [
    { key: "cases", label: "Объём дел", score: Math.min(matched.length * 2, 28), max: 28 },
    { key: "courts", label: "Разные суды", score: Math.min(courtMap.size * 2, 12), max: 12 },
    { key: "acts", label: "С актами", score: Math.min(withActsN, 10), max: 10 },
    { key: "enriched", label: "Полные карточки", score: Math.min(enrichedN, 12), max: 12 },
    { key: "win", label: "Доля побед", score: winRate != null ? Math.round(winRate * 16) : 0, max: 16 },
    { key: "geo", label: "География", score: Math.min(regionMap.size * 2, 6), max: 6 },
  ];

  return {
    person: {
      ...person,
      cases: matched.length,
      courts: courtMap.size,
      withActs: withActsN,
      enrichedCases: enrichedN,
    },
    rating,
    tier: tierFrom(matched.length, winRate),
    roleLabel: ROLE_FAMILY_LABELS[person.primaryFamily],
    stats: {
      cases: matched.length,
      courts: courtMap.size,
      withActs: withActsN,
      enrichedCases: enrichedN,
      knownOutcomes: known,
      wins,
      losses,
      neutrals,
      winRate,
      medianDays: median(durations),
    },
    outcomes,
    byCourt: [...courtMap.values()].sort((a, b) => b.count - a.count),
    byCategory: [...catMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
    geoHeat: [...regionMap.entries()]
      .map(([region, cases]) => ({
        region,
        label: REGION_NAMES[region] ?? `Регион ${region}`,
        cases,
      }))
      .sort((a, b) => b.cases - a.cases),
    ratingFactors,
    byYear: [...yearMap.entries()]
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => a.year.localeCompare(b.year)),
    cases: rows,
    caveat:
      person.primaryFamily === "representative"
        ? "Win-rate ориентировочный: удовлетворение иска считаем «победой» представителя (без жёсткой привязки стороны)."
        : "Статистика по всем делам, где это лицо встречается в выбранной роли.",
  };
}

/** Cases where this person appears in a matching role (for dossier / drill-down). */
export function casesForParticipant(
  catalog: CaseCatalog,
  name: string,
  roleFilter?: string,
  limit = 50,
): StoredCase[] {
  const needle = name.trim().toLowerCase();
  if (!needle) return [];
  const out: StoredCase[] = [];
  catalog.forEach((c) => {
    if (out.length >= limit) return;
    if (caseHasParticipant(c, needle, roleFilter)) out.push(c);
  });
  return out;
}

export function caseHasParticipant(
  c: StoredCase,
  nameNeedleLower: string,
  roleFilter?: string,
): boolean {
  const role = roleFilter?.trim() || "all";
  const matchName = (n?: string) => (n ?? "").toLowerCase().includes(nameNeedleLower);

  for (const p of c.participants ?? []) {
    if (!matchName(p.name)) continue;
    if (roleMatchesFilter(p.role || "", role)) return true;
  }

  // Flat fields for party roles
  if (role === "all" || familyMatchesFilter("plaintiff", role)) {
    if (matchName(c.plaintiff)) return true;
  }
  if (role === "all" || familyMatchesFilter("defendant", role)) {
    if (matchName(c.defendant)) return true;
  }
  if (role === "all" || familyMatchesFilter("judge", role)) {
    if (matchName(c.judge)) return true;
  }
  if (role === "all" && (matchName(c.parties))) return true;

  return false;
}
