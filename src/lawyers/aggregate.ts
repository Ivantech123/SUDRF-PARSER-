// Build FIFA-style lawyer/judge cards from the case catalog (not RAG).

import { COURT_REGISTRY } from "../sudrf/courts.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { CaseCatalog, StoredCase } from "../cases/store.js";
import { isDepersonalizedMarker } from "../analytics/person-name.js";
import { classifyOutcome, type OutcomeLabel } from "../analytics/outcome.js";
import { parseRuDate } from "../analytics/deep-analytics.js";

export type CardTier = "gold" | "silver" | "bronze" | "common";
export type ProfessionalRole = "lawyer" | "judge";

export interface LawyerCardStats {
  cases: number;
  courts: number;
  documents: number;
  categories: number;
  enrichedCases: number;
  regions: number;
  civilCases: number;
  criminalCases: number;
  withActs: number;
  /** ISO date of most recent linked case */
  lastActive?: string;
}

export interface RatingFactor {
  key: string;
  label: string;
  score: number;
  max: number;
}

export interface GeoHeatCell {
  region: string;
  label: string;
  cases: number;
}

export interface CourtHeatCell {
  subdomain: string;
  name: string;
  cases: number;
}

/** Judge-only practice metrics (speed, appeals, banks, outcomes). */
export interface JudgePractice {
  medianDays: number | null;
  p75Days: number | null;
  withDuration: number;
  knownOutcomes: number;
  plaintiffFavorable: number;
  denied: number;
  plaintiffFavorRate: number | null;
  appealReviewed: number;
  appealChanged: number;
  appealChangeRate: number | null;
  bankCases: number;
  bankFavorable: number;
  bankFavorRate: number | null;
  firstInstance: number;
  appealLike: number;
  outcomes: Record<string, number>;
}

export interface LawyerCard {
  id: string;
  name: string;
  roles: string[];
  primaryRole: ProfessionalRole;
  roleLabel: string;
  rating: number;
  tier: CardTier;
  stats: LawyerCardStats;
  mainCourt: string;
  mainCourtSubdomain: string;
  region?: string;
  regions: string[];
  categories: string[];
  caseIds: string[];
  /** Contribution breakdown for the 55–99 rating */
  ratingFactors: RatingFactor[];
  /** Cases by federal subject code — for Russia heat map */
  geoHeat: GeoHeatCell[];
  /** Cases by court subdomain */
  courtHeat: CourtHeatCell[];
  /** Top categories with counts */
  categoryHeat: Array<{ name: string; count: number }>;
  /** Present only for judges */
  judgePractice?: JudgePractice;
  recentCases: Array<{
    id: string;
    caseNumber: string;
    courtName: string;
    category: string;
    status?: string;
    hearingDate?: string;
    hasDocuments: boolean;
  }>;
}

export interface LawyerHeatmapCell {
  region: string;
  label: string;
  lawyers: number;
  judges: number;
  total: number;
  /** When professionals sparse — heat from case catalog counts */
  caseCount?: number;
}

interface CaseRef {
  id: string;
  caseNumber: string;
  courtName: string;
  courtSubdomain: string;
  courtRegion?: string;
  category: string;
  status?: string;
  hearingDate?: string;
  documentsCount: number;
  hasActText: boolean;
  collectedAt: string;
  enrichedAt?: string;
}

interface PersonAcc {
  name: string;
  roles: Set<string>;
  cases: Map<string, CaseRef>;
  courts: Map<string, { name: string; subdomain: string; region?: string }>;
  regions: Set<string>;
  categories: Set<string>;
  documents: number;
  enrichedCases: number;
  withActs: number;
  civilCases: number;
  criminalCases: number;
  lastActive: string;
}

const ROLE_LABELS: Record<ProfessionalRole, string> = {
  lawyer: "ЮР",
  judge: "СУД",
};

const SKIP_NAME = /^(не указ|неизвест|нет данных|—|-)$/i;
const CIVIL_RE = /граждан|спор|иск|экон|банкрот|семейн|трудов|жилищ/i;
const CRIM_RE = /уголов/i;
const LAWYER_IN_TEXT = /(?:адвокат|представител(?:ь|я)|защитник|юрисконсульт)[:\s—-]+([^.;,\n]+)/gi;

const REGION_LABELS = buildRegionLabels();

function buildRegionLabels(): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of COURT_REGISTRY) {
    if (!c.region || c.region === "0" || out.has(c.region)) continue;
    const m =
      c.name.match(/Республики?\s+([А-Яа-яё\-«»\s]+?)(?:\s|$|,)/i)
      ?? c.name.match(/([А-Яа-яё\-]+(?:ская|ский|ская|ская|ая))\s+област/i)
      ?? c.name.match(/([А-Яа-яё\-]+(?:ский|ская))\s+кра/i);
    if (m?.[1]) out.set(c.region, m[1].trim().replace(/\s+/g, " "));
    else if (/москва/i.test(c.name)) out.set(c.region, "Москва");
    else if (/петербург/i.test(c.name)) out.set(c.region, "СПб");
    else out.set(c.region, `Рег. ${c.region}`);
  }
  out.set("13", "Мордовия");
  return out;
}

function regionLabel(code: string | undefined): string {
  if (!code) return "—";
  return REGION_LABELS.get(code) ?? `Рег. ${code}`;
}

let cardsCache: { catalogSize: number; cards: LawyerCard[] } | null = null;
let indexReady = false;
/** Single-flight guard — concurrent callers share one background build */
let buildInFlight: Promise<LawyerCard[]> | null = null;

function caseRef(c: StoredCase): CaseRef {
  return {
    id: c.id,
    caseNumber: c.caseNumber,
    courtName: c.courtName,
    courtSubdomain: c.courtSubdomain,
    courtRegion: c.courtRegion,
    category: c.category,
    status: c.status,
    hearingDate: c.hearingDate,
    documentsCount: c.documentsCount || c.documents.length,
    hasActText: c.hasActText,
    collectedAt: c.collectedAt,
    enrichedAt: c.enrichedAt,
  };
}

function loadDiskCache(catalogSize: number): LawyerCard[] | null {
  const path = process.env.SUDRF_LAWYERS_CACHE_PATH;
  if (!path || !existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as { catalogSize: number; cards: LawyerCard[] };
    if (
      data.catalogSize === catalogSize
      && Array.isArray(data.cards)
      && data.cards.length > 0
      && Array.isArray(data.cards[0]?.ratingFactors)
      && Array.isArray(data.cards[0]?.geoHeat)
      && data.cards.some((c) => c.primaryRole !== "judge" || c.judgePractice)
    ) {
      return data.cards;
    }
  } catch { /* ignore */ }
  return null;
}

function saveDiskCache(catalogSize: number, cards: LawyerCard[]): void {
  const path = process.env.SUDRF_LAWYERS_CACHE_PATH;
  if (!path) return;
  try {
    writeFileSync(path, JSON.stringify({ catalogSize, builtAt: new Date().toISOString(), cards }), "utf8");
  } catch (e) {
    console.error("[lawyers] cache save failed:", e);
  }
}

export function isLawyerIndexReady(): boolean {
  return indexReady;
}

function getCachedCards(catalog: CaseCatalog): LawyerCard[] | null {
  if (cardsCache?.catalogSize === catalog.size) return cardsCache.cards;
  const disk = loadDiskCache(catalog.size);
  if (disk) {
    cardsCache = { catalogSize: catalog.size, cards: disk };
    indexReady = true;
    console.log(`[lawyers] loaded ${disk.length} cards from disk cache`);
    return disk;
  }
  return null;
}

/** Awaitable index build — use from MCP/REST tools that need cards immediately. */
export function ensureLawyerIndexBuild(catalog: CaseCatalog): Promise<LawyerCard[]> {
  const cached = getCachedCards(catalog);
  if (cached) return Promise.resolve(cached);
  if (buildInFlight) return buildInFlight;

  buildInFlight = new Promise<LawyerCard[]>((resolve, reject) => {
    setImmediate(() => {
      try {
        const again = getCachedCards(catalog);
        if (again) {
          resolve(again);
          return;
        }
        const t0 = Date.now();
        const cards = buildLawyerCardsUncached(catalog);
        cardsCache = { catalogSize: catalog.size, cards };
        saveDiskCache(catalog.size, cards);
        indexReady = true;
        const judges = cards.filter((c) => c.primaryRole === "judge").length;
        const lawyers = cards.filter((c) => c.primaryRole === "lawyer").length;
        console.log(
          `[lawyers] index ready: ${cards.length} cards (${judges} judges, ${lawyers} lawyers) in ${Date.now() - t0}ms`,
        );
        resolve(cards);
      } catch (e) {
        console.error("[lawyers] index build failed:", e);
        reject(e);
      } finally {
        buildInFlight = null;
      }
    });
  });
  return buildInFlight;
}

export function warmLawyerIndex(catalog: CaseCatalog): void {
  if (indexReady || buildInFlight) return;
  void ensureLawyerIndexBuild(catalog).catch(() => { /* logged above */ });
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, "e")
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function normName(raw: string, role?: string): string | null {
  const n = raw.replace(/\s+/g, " ").trim();
  const minLen = role === "judge" ? 3 : 4;
  if (isDepersonalizedMarker(n)) return null;
  if (n.length < minLen || SKIP_NAME.test(n)) return null;
  if (/^\d+$/.test(n)) return null;
  if (/^(ооо|пао|ао|ип|г\.?\s)/i.test(n)) return null;
  if (/^(не\s*назнач|не\s*определ|отложен|перенес)/i.test(n)) return null;
  // Фамилия И.О. or И.О. Фамилия
  if (/^[А-ЯЁA-Z][а-яёa-z\-]+\s+[А-ЯЁA-Z]\./.test(n)) return n;
  if (/^[А-ЯЁA-Z]\.\s*[А-ЯЁA-Z]\.\s+[А-ЯЁA-Z][а-яёa-z\-]+/.test(n)) return n;
  return n;
}

function roleFromParticipant(role: string): string {
  const r = role.toLowerCase();
  if (/судья|председ/i.test(r)) return "judge";
  if (/адвокат|представ|юрискон/i.test(r)) return "lawyer";
  return "participant";
}

function isCivil(cat: string): boolean {
  return CIVIL_RE.test(cat);
}

function isCriminal(cat: string): boolean {
  return CRIM_RE.test(cat);
}

function lawyersFromText(text: string): string[] {
  const names: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(LAWYER_IN_TEXT.source, "gi");
  while ((m = re.exec(text)) !== null) {
    const chunk = m[1]?.split(/\s+/).slice(0, 4).join(" ").trim();
    if (chunk && chunk.length >= 6) names.push(chunk);
  }
  return names;
}

function addPerson(acc: Map<string, PersonAcc>, name: string, role: string, c: StoredCase): void {
  if (role !== "lawyer" && role !== "judge") return;
  const n = normName(name, role);
  if (!n) return;
  const key = n.toLowerCase();
  const ref = caseRef(c);
  let p = acc.get(key);
  if (!p) {
    p = {
      name: n,
      roles: new Set(),
      cases: new Map(),
      courts: new Map(),
      regions: new Set(),
      categories: new Set(),
      documents: 0,
      enrichedCases: 0,
      withActs: 0,
      civilCases: 0,
      criminalCases: 0,
      lastActive: c.collectedAt,
    };
    acc.set(key, p);
  }
  if (p.cases.has(c.id)) return;
  p.roles.add(role);
  p.cases.set(c.id, ref);
  p.courts.set(c.courtSubdomain, { name: c.courtName, subdomain: c.courtSubdomain, region: c.courtRegion });
  if (c.courtRegion) p.regions.add(c.courtRegion);
  if (c.category) p.categories.add(c.category);
  p.documents += ref.documentsCount;
  if (c.enrichedAt) p.enrichedCases++;
  if (ref.hasActText || ref.documentsCount > 0) p.withActs++;
  if (isCivil(c.category)) p.civilCases++;
  if (isCriminal(c.category)) p.criminalCases++;
  if (c.collectedAt > p.lastActive) p.lastActive = c.collectedAt;
}

function splitNames(raw: string): string[] {
  return raw
    .split(/[,;/]|(?:\s+и\s+)|(?:\s+и\s+судья)/i)
    .map((s) => s.replace(/^судья[:\s]*/i, "").trim())
    .filter(Boolean);
}

function extractProfessionals(c: StoredCase): Array<{ name: string; role: ProfessionalRole }> {
  const out: Array<{ name: string; role: ProfessionalRole }> = [];
  if (c.judge) {
    for (const name of splitNames(c.judge)) {
      out.push({ name, role: "judge" });
    }
  }
  for (const p of c.participants ?? []) {
    if (!p.name) continue;
    const role = roleFromParticipant(p.role);
    if (role === "lawyer" || role === "judge") {
      for (const name of splitNames(p.name)) out.push({ name, role });
    }
  }
  for (const ev of c.events ?? []) {
    if (/судья|председ/i.test(ev.name) && ev.result?.trim()) {
      for (const name of splitNames(ev.result)) out.push({ name, role: "judge" });
    }
  }
  const textBlob = [c.parties, c.plaintiff, c.defendant].filter(Boolean).join(" ");
  for (const name of lawyersFromText(textBlob)) {
    out.push({ name, role: "lawyer" });
  }
  return out;
}

function professionalPrimaryRole(roles: Set<string>): ProfessionalRole | null {
  if (roles.has("lawyer")) return "lawyer";
  if (roles.has("judge")) return "judge";
  return null;
}

function ratingFactors(p: PersonAcc, role: ProfessionalRole): RatingFactor[] {
  const cases = Math.min(p.cases.size * 3, 28);
  const courts = Math.min(p.courts.size * 2, 12);
  const acts = Math.min(p.withActs, 10);
  const enriched = Math.min(p.enrichedCases, 12);
  const docs = Math.min(Math.floor(p.documents / 2), 8);
  const cats = Math.min(p.categories.size, 6);
  const multiRegion = p.regions.size > 1 ? 4 : p.regions.size === 1 ? 1 : 0;
  const roleBonus = role === "lawyer" ? 6 : 4;
  return [
    { key: "cases", label: "Объём дел", score: cases, max: 28 },
    { key: "courts", label: "Разные суды", score: courts, max: 12 },
    { key: "acts", label: "С актами", score: acts, max: 10 },
    { key: "enriched", label: "Полные карточки", score: enriched, max: 12 },
    { key: "docs", label: "Документы", score: docs, max: 8 },
    { key: "cats", label: "Категории споров", score: cats, max: 6 },
    { key: "geo", label: "География", score: multiRegion, max: 4 },
    { key: "role", label: role === "lawyer" ? "Роль юриста" : "Роль судьи", score: roleBonus, max: 6 },
  ];
}

function calcRating(p: PersonAcc, role: ProfessionalRole): number {
  const base = 55;
  const sum = ratingFactors(p, role).reduce((a, f) => a + f.score, 0);
  return Math.min(99, Math.max(55, Math.round(base + sum * 0.45)));
}

function buildGeoHeat(p: PersonAcc): GeoHeatCell[] {
  const counts = new Map<string, number>();
  for (const c of p.cases.values()) {
    const code = c.courtRegion || ( /--mor$/i.test(c.courtSubdomain) ? "13" : "" );
    if (!code) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([region, cases]) => ({ region, label: regionLabel(region), cases }))
    .sort((a, b) => b.cases - a.cases);
}

function buildCourtHeat(p: PersonAcc): CourtHeatCell[] {
  const counts = new Map<string, number>();
  for (const c of p.cases.values()) {
    counts.set(c.courtSubdomain, (counts.get(c.courtSubdomain) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([subdomain, cases]) => ({
      subdomain,
      name: p.courts.get(subdomain)?.name ?? subdomain,
      cases,
    }))
    .sort((a, b) => b.cases - a.cases)
    .slice(0, 16);
}

function buildCategoryHeat(p: PersonAcc): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const c of p.cases.values()) {
    const cat = (c.category || "—").split("→")[0]!.trim().slice(0, 60);
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
}

function tierFromRating(r: number): CardTier {
  if (r >= 88) return "gold";
  if (r >= 78) return "silver";
  if (r >= 68) return "bronze";
  return "common";
}

function mainCourt(p: PersonAcc): { name: string; subdomain: string; region?: string } {
  const counts = new Map<string, number>();
  for (const c of p.cases.values()) {
    counts.set(c.courtSubdomain, (counts.get(c.courtSubdomain) ?? 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [sub, n] of counts) {
    if (n > bestN) { best = sub; bestN = n; }
  }
  return p.courts.get(best) ?? { name: "—", subdomain: best };
}

function buildLawyerCardsUncached(catalog: CaseCatalog): LawyerCard[] {
  const acc = new Map<string, PersonAcc>();
  let scanned = 0;

  catalog.forEach((c) => {
    const hasJudge = Boolean(c.judge?.trim());
    const hasParts = (c.participants?.length ?? 0) > 0;
    const hasLawyerText = /адвокат|представ|юрискон/i.test(c.parties ?? "");
    if (!hasJudge && !hasParts && !hasLawyerText && !c.enrichedAt) return;
    scanned++;
    for (const { name, role } of extractProfessionals(c)) {
      addPerson(acc, name, role, c);
    }
  });

  const cards: LawyerCard[] = [];
  for (const p of acc.values()) {
    const role = professionalPrimaryRole(p.roles);
    if (!role) continue;
    const rating = calcRating(p, role);
    const mc = mainCourt(p);
    const caseList = [...p.cases.values()].sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));

    const factors = ratingFactors(p, role);
    cards.push({
      id: slug(p.name),
      name: p.name,
      roles: [...p.roles].filter((r) => r === "lawyer" || r === "judge"),
      primaryRole: role,
      roleLabel: ROLE_LABELS[role],
      rating,
      tier: tierFromRating(rating),
      stats: {
        cases: p.cases.size,
        courts: p.courts.size,
        documents: p.documents,
        categories: p.categories.size,
        enrichedCases: p.enrichedCases,
        regions: p.regions.size,
        civilCases: p.civilCases,
        criminalCases: p.criminalCases,
        withActs: p.withActs,
        lastActive: p.lastActive,
      },
      mainCourt: mc.name,
      mainCourtSubdomain: mc.subdomain,
      region: mc.region,
      regions: [...p.regions],
      categories: [...p.categories].slice(0, 8),
      caseIds: caseList.map((c) => c.id),
      ratingFactors: factors,
      geoHeat: buildGeoHeat(p),
      courtHeat: buildCourtHeat(p),
      categoryHeat: buildCategoryHeat(p),
      recentCases: caseList.slice(0, 24).map((c) => ({
        id: c.id,
        caseNumber: c.caseNumber,
        courtName: c.courtName,
        category: c.category,
        status: c.status,
        hearingDate: c.hearingDate,
        hasDocuments: c.documentsCount > 0 || c.hasActText,
      })),
    });
  }

  attachJudgePractice(catalog, cards);

  cards.sort((a, b) => b.rating - a.rating || b.stats.cases - a.stats.cases);
  console.log(`[lawyers] built ${cards.length} cards from ${scanned} relevant / ${catalog.size} total cases`);
  return cards;
}

const BANK_RE =
  /банк|сбер|втб|газпромбанк|альфа|тинькофф|тиньков|росбанк|открытие|совком|почта\s*банк|райффайзен|юникредит|россельхоз|мтс\s*банк/i;

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function percentile(nums: number[], p: number): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1));
  return s[idx]!;
}

function caseDurationDays(c: StoredCase): number | null {
  const start = parseRuDate(c.entryDate);
  let end = parseRuDate(c.resultDate);
  if (!end) {
    for (const d of c.documents) {
      const dt = parseRuDate(d.date);
      if (dt && (!end || dt > end)) end = dt;
    }
  }
  if (!start || !end) return null;
  const n = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (n < 0 || n > 4000) return null;
  return n;
}

function outcomeOf(c: StoredCase): OutcomeLabel {
  return classifyOutcome({
    status: c.status,
    events: c.events,
    documentText: c.documents.map((d) => d.text ?? "").join("\n"),
  }).label;
}

function isFav(label: OutcomeLabel): boolean {
  return label === "granted" || label === "granted_partial";
}

type JudgeAcc = {
  durations: number[];
  known: number;
  fav: number;
  den: number;
  bank: number;
  bankFav: number;
  appealRev: number;
  appealCh: number;
  firstInstance: number;
  appealLike: number;
  outcomes: Record<string, number>;
};

function emptyJudgeAcc(): JudgeAcc {
  return {
    durations: [],
    known: 0,
    fav: 0,
    den: 0,
    bank: 0,
    bankFav: 0,
    appealRev: 0,
    appealCh: 0,
    firstInstance: 0,
    appealLike: 0,
    outcomes: {},
  };
}

function nameKey(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Fill judgePractice on judge cards from catalog (speed, appeals, banks, outcomes). */
function attachJudgePractice(catalog: CaseCatalog, cards: LawyerCard[]): void {
  const byName = new Map<string, JudgeAcc>();
  const ensure = (raw: string): JudgeAcc => {
    const key = nameKey(raw);
    let a = byName.get(key);
    if (!a) {
      a = emptyJudgeAcc();
      byName.set(key, a);
    }
    return a;
  };

  catalog.forEach((c) => {
    const jn = c.judge?.replace(/\s+/g, " ").trim();
    if (jn) {
      for (const part of jn.split(/[,;/]|(?:\s+и\s+)/i).map((s) => s.replace(/^судья[:\s]*/i, "").trim()).filter(Boolean)) {
        const a = ensure(part);
        const label = outcomeOf(c);
        a.outcomes[label] = (a.outcomes[label] ?? 0) + 1;
        if (/^2/i.test(c.caseNumber)) a.firstInstance++;
        if (/^11-/.test(c.caseNumber)) a.appealLike++;
        const dur = caseDurationDays(c);
        if (dur != null && /^2/i.test(c.caseNumber)) a.durations.push(dur);
        if (label !== "unknown" && /^2/i.test(c.caseNumber)) {
          a.known++;
          if (isFav(label)) a.fav++;
          if (label === "denied") a.den++;
        }
        if (/^2/i.test(c.caseNumber) && BANK_RE.test(c.plaintiff ?? "")) {
          a.bank++;
          if (isFav(label)) a.bankFav++;
        }
      }
    }

    // Appeals attributed to first-instance judge
    if (/^11-/.test(c.caseNumber.trim())) {
      const fiJ = c.firstInstance?.judge?.replace(/\s+/g, " ").trim();
      if (!fiJ) return;
      const label = outcomeOf(c);
      if (label !== "appealed_upheld" && label !== "appealed_changed") return;
      const a = ensure(fiJ);
      a.appealRev++;
      if (label === "appealed_changed") a.appealCh++;
    }
  });

  for (const card of cards) {
    if (card.primaryRole !== "judge") continue;
    const a = byName.get(nameKey(card.name));
    if (!a) {
      card.judgePractice = {
        medianDays: null,
        p75Days: null,
        withDuration: 0,
        knownOutcomes: 0,
        plaintiffFavorable: 0,
        denied: 0,
        plaintiffFavorRate: null,
        appealReviewed: 0,
        appealChanged: 0,
        appealChangeRate: null,
        bankCases: 0,
        bankFavorable: 0,
        bankFavorRate: null,
        firstInstance: 0,
        appealLike: 0,
        outcomes: {},
      };
      continue;
    }
    card.judgePractice = {
      medianDays: median(a.durations),
      p75Days: percentile(a.durations, 0.75),
      withDuration: a.durations.length,
      knownOutcomes: a.known,
      plaintiffFavorable: a.fav,
      denied: a.den,
      plaintiffFavorRate: a.known ? a.fav / a.known : null,
      appealReviewed: a.appealRev,
      appealChanged: a.appealCh,
      appealChangeRate: a.appealRev ? a.appealCh / a.appealRev : null,
      bankCases: a.bank,
      bankFavorable: a.bankFav,
      bankFavorRate: a.bank ? a.bankFav / a.bank : null,
      firstInstance: a.firstInstance,
      appealLike: a.appealLike,
      outcomes: a.outcomes,
    };
  }
}

export function buildLawyerCards(catalog: CaseCatalog): LawyerCard[] {
  const cached = getCachedCards(catalog);
  if (cached) return cached;
  warmLawyerIndex(catalog);
  return [];
}

function caseHeatmapCells(catalog: CaseCatalog, role?: "lawyer" | "judge"): LawyerHeatmapCell[] {
  return catalog.regions().slice(0, 30).map((r) => ({
    region: r.region,
    label: regionLabel(r.region),
    lawyers: 0,
    judges: 0,
    total: r.count,
    caseCount: r.count,
  }));
}

export function listLawyerCards(
  catalog: CaseCatalog,
  opts: { q?: string; role?: string; limit?: number; offset?: number } = {},
): { total: number; lawyers: LawyerCard[]; indexReady: boolean } {
  const cards = getCachedCards(catalog);
  if (!cards) {
    warmLawyerIndex(catalog);
    return { total: 0, lawyers: [], indexReady: false };
  }

  let rows = cards;

  const role = opts.role?.trim();
  if (role === "lawyer" || role === "judge") {
    rows = rows.filter((l) => l.primaryRole === role || l.roles.includes(role));
  } else {
    rows = rows.filter((l) => l.primaryRole === "lawyer" || l.primaryRole === "judge");
  }

  const q = opts.q?.trim().toLowerCase();
  if (q) {
    rows = rows.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.mainCourt.toLowerCase().includes(q) ||
        l.categories.some((c) => c.toLowerCase().includes(q)) ||
        l.regions.some((r) => regionLabel(r).toLowerCase().includes(q)),
    );
  }

  const total = rows.length;
  const offset = opts.offset ?? 0;
  const limit = Math.min(opts.limit ?? 48, 120);
  return { total, lawyers: rows.slice(offset, offset + limit), indexReady: true };
}

export function lawyerHeatmap(
  catalog: CaseCatalog,
  role?: "lawyer" | "judge",
): { cells: LawyerHeatmapCell[]; mode: "professionals" | "cases" } {
  const cards = getCachedCards(catalog);
  if (!cards?.length) {
    warmLawyerIndex(catalog);
    return { cells: caseHeatmapCells(catalog, role), mode: "cases" };
  }

  const byRegion = new Map<string, { lawyers: number; judges: number }>();

  for (const c of cards) {
    const code = c.region ?? c.regions[0];
    if (!code) continue;
    if (role && c.primaryRole !== role && !c.roles.includes(role)) continue;

    const cur = byRegion.get(code) ?? { lawyers: 0, judges: 0 };
    if (c.primaryRole === "lawyer" || c.roles.includes("lawyer")) cur.lawyers++;
    if (c.primaryRole === "judge" || c.roles.includes("judge")) cur.judges++;
    byRegion.set(code, cur);
  }

  const cells = [...byRegion.entries()]
    .map(([region, v]) => ({
      region,
      label: regionLabel(region),
      lawyers: v.lawyers,
      judges: v.judges,
      total: role === "judge" ? v.judges : role === "lawyer" ? v.lawyers : v.lawyers + v.judges,
    }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);

  if (cells.length > 0) return { cells, mode: "professionals" };

  return { cells: caseHeatmapCells(catalog, role), mode: "cases" };
}

export function getLawyerCard(catalog: CaseCatalog, idOrName: string): LawyerCard | undefined {
  const cards = getCachedCards(catalog);
  if (!cards) {
    warmLawyerIndex(catalog);
    return undefined;
  }
  const key = idOrName.toLowerCase();
  return cards.find(
    (l) => l.id === key || l.name.toLowerCase() === key || l.name.toLowerCase().includes(key),
  );
}

export function profileDisplayName(parts: {
  firstName?: string;
  lastName?: string;
  patronymic?: string;
}): string {
  return [parts.lastName, parts.firstName, parts.patronymic].filter(Boolean).join(" ").trim();
}

export function findCardForProfile(
  catalog: CaseCatalog,
  parts: { firstName?: string; lastName?: string; patronymic?: string },
  preferRole?: string,
): LawyerCard | undefined {
  const full = profileDisplayName(parts);
  if (full.length < 4) return undefined;

  const cards = getCachedCards(catalog);
  if (!cards) {
    warmLawyerIndex(catalog);
    return undefined;
  }
  const fullLower = full.toLowerCase();
  const ln = parts.lastName?.trim().toLowerCase() ?? "";
  const fn = parts.firstName?.trim().toLowerCase() ?? "";

  const candidates = cards.filter((c) => {
    const n = c.name.toLowerCase();
    if (n === fullLower) return true;
    if (ln && fn && n.includes(ln) && n.includes(fn)) return true;
    if (ln.length >= 3 && n.includes(ln) && fn && n.split(/\s+/).some((w) => w.startsWith(fn[0]))) return true;
    return false;
  });

  if (!candidates.length) return undefined;

  if (preferRole === "lawyer" || preferRole === "judge") {
    const roleHit = candidates.find((c) => c.primaryRole === preferRole || c.roles.includes(preferRole));
    if (roleHit) return roleHit;
  }

  return candidates.sort((a, b) => b.rating - a.rating)[0];
}
