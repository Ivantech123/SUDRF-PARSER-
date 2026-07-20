// Deep Mordovia analytics: judges, seasonality, economics, anomalies.
// Heuristic — calibrated on catalog fields + act-text regex; not legal advice.

import type { StoredCase } from "../cases/store.js";
import { classifyOutcome, type OutcomeLabel } from "./outcome.js";

export interface JudgeDeepRow {
  name: string;
  cases: number;
  withDuration: number;
  medianDays: number | null;
  p75Days: number | null;
  knownOutcomes: number;
  plaintiffFavorable: number;
  denied: number;
  plaintiffFavorRate: number | null;
  bankCases: number;
  bankFavorable: number;
  bankFavorRate: number | null;
  appealReviewed: number;
  appealChanged: number;
  appealChangeRate: number | null;
  intensity: number; // 0..1 by cases
}

export interface SeasonMonth {
  month: number; // 1..12
  label: string;
  total: number;
  communal: number;
  divorce: number;
  dtp: number;
  credit: number;
  other: number;
}

export interface LifecycleStats {
  sampleSize: number;
  medianDays: number | null;
  p25Days: number | null;
  p75Days: number | null;
  meanDays: number | null;
}

export interface AmountConversion {
  casesWithClaim: number;
  casesWithAward: number;
  casesWithBoth: number;
  medianClaim: number | null;
  medianAward: number | null;
  medianConversion: number | null; // award/claim
  totalClaim: number;
  totalAward: number;
}

export interface SerialPlaintiff {
  name: string;
  cases: number;
  knownOutcomes: number;
  wins: number;
  losses: number;
  winRate: number | null;
  kind: "bank" | "uk" | "insurance" | "other";
  sampleCaseNumbers: string[];
}

export interface StuckCase {
  caseNumber: string;
  court: string;
  judge?: string;
  entryDate?: string;
  ageDays: number | null;
  status?: string;
  hasActText: boolean;
}

export interface PracticeMonth {
  ym: string; // YYYY-MM
  total: number;
  known: number;
  granted: number;
  denied: number;
  grantedRate: number | null;
}

export interface DeepAnalytics {
  judges: JudgeDeepRow[];
  seasonality: SeasonMonth[];
  lifecycle: LifecycleStats;
  amounts: AmountConversion;
  serialPlaintiffs: SerialPlaintiff[];
  stuckUnknown: StuckCase[];
  practiceShift: PracticeMonth[];
  notes: string[];
}

const MONTH_LABELS = [
  "", "янв", "фев", "мар", "апр", "май", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];

export function parseRuDate(raw?: string): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  const m = s.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d, 12, 0, 0, 0);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

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

function mean(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function normalizeName(s: string): string {
  return s.replace(/\s+/g, " ").replace(/["«»]/g, "").trim().toLowerCase();
}

function judgeName(c: StoredCase): string | null {
  const j = c.judge?.replace(/\s+/g, " ").trim();
  return j || null;
}

function isFi(num: string): boolean {
  return /^2/i.test(num.trim());
}

function isAppeal(num: string): boolean {
  return /^11-/.test(num.trim());
}

function outcomeOf(c: StoredCase): OutcomeLabel {
  return classifyOutcome({
    status: c.status,
    events: c.events,
    documentText: c.documents.map((d) => d.text ?? "").join("\n"),
  }).label;
}

function isPlaintiffFavorable(label: OutcomeLabel): boolean {
  return label === "granted" || label === "granted_partial";
}

function isDenied(label: OutcomeLabel): boolean {
  return label === "denied";
}

function lastActDate(c: StoredCase): Date | null {
  let best: Date | null = null;
  for (const d of c.documents) {
    const dt = parseRuDate(d.date);
    if (dt && (!best || dt > best)) best = dt;
  }
  return best;
}

function endDate(c: StoredCase): Date | null {
  return parseRuDate(c.resultDate) ?? lastActDate(c);
}

function durationDays(c: StoredCase): number | null {
  const start = parseRuDate(c.entryDate);
  const end = endDate(c);
  if (!start || !end) return null;
  const n = daysBetween(start, end);
  if (n < 0 || n > 4000) return null;
  return n;
}

const BANK_RE =
  /банк|сбер|втб|газпромбанк|альфа|тинькофф|тиньков|росбанк|открытие|совком|почта\s*банк|райффайзен|юникредит|россельхоз|мтс\s*банк|киви|qiwi/i;
const UK_RE = /управл\w*\s+компан|тсж|жск|жкх|ук\s+[«"]|ооо\s+ук\b/i;
const INS_RE = /страх\w*|ингосстрах|росгосстрах|ресо|согаз|альфастрах|вск\b|мак[сc]/i;
const COMMUNAL_RE = /коммунал|жкх|электроэнерг|теплоснаб|водоснаб|газоснаб|коллективн\w*\s+услуг|задолженност\w*\s+по\s+оплате/i;
const DIVORCE_RE = /расторжен\w*\s+брак|алимент|раздел\w*\s+имуществ|брачн/i;
const DTP_RE = /дтп|дорожно.?транспорт|осаго|каско|возмещен\w*\s+вред\w*\s+в\s+результат/i;
const CREDIT_RE = /кредитн|заем|займ|микрофинанс|мфо|неустойк\w*\s+по\s+договор/i;

export function partyKind(name: string): SerialPlaintiff["kind"] {
  if (BANK_RE.test(name)) return "bank";
  if (UK_RE.test(name)) return "uk";
  if (INS_RE.test(name)) return "insurance";
  return "other";
}

function seasonBucket(c: StoredCase): keyof Omit<SeasonMonth, "month" | "label" | "total"> {
  const blob = `${c.category ?? ""} ${c.status ?? ""} ${c.plaintiff ?? ""}`;
  if (COMMUNAL_RE.test(blob)) return "communal";
  if (DIVORCE_RE.test(blob)) return "divorce";
  if (DTP_RE.test(blob)) return "dtp";
  if (CREDIT_RE.test(blob) || BANK_RE.test(c.plaintiff ?? "")) return "credit";
  return "other";
}

/** Parse Russian money amounts: 12 345,67 / 12345.67 / 12.345,67 */
export function parseMoneyRu(raw: string): number | null {
  let s = raw.replace(/\s+/g, "").replace(/&nbsp;/gi, "");
  if (!s) return null;
  // 12.345.678,90 or 12 345,90 already stripped spaces
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > 1e12) return null;
  return n;
}

function extractAmounts(text: string): { claim: number | null; award: number | null } {
  if (!text || text.length < 40) return { claim: null, award: null };
  const head = text.slice(0, 8000);
  const tail = text.slice(-6000);
  const blob = `${head}\n${tail}`;

  const money = "(\\d[\\d\\s.\\u00a0]{0,18}\\d(?:[,.]\\d{1,2})?)";
  const claimRe = new RegExp(
    `(?:исков\\w*\\s+требован\\w*|сумм\\w*\\s+иск\\w*|о\\s+взыскании)\\D{0,80}${money}\\s*(?:руб|₽)`,
    "gi",
  );
  const awardRe = new RegExp(
    `(?:взыскать|взыскан\\w*|присудить)\\D{0,60}${money}\\s*(?:руб|₽)`,
    "gi",
  );

  const claims: number[] = [];
  const awards: number[] = [];
  for (const re of [claimRe]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(blob))) {
      const v = parseMoneyRu(m[1] ?? "");
      if (v && v >= 100) claims.push(v);
    }
  }
  for (const re of [awardRe]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(blob))) {
      const v = parseMoneyRu(m[1] ?? "");
      if (v && v >= 100) awards.push(v);
    }
  }
  return {
    claim: claims.length ? Math.max(...claims) : null,
    award: awards.length ? Math.max(...awards) : null,
  };
}

function actText(c: StoredCase): string {
  return c.documents.map((d) => d.text ?? "").join("\n");
}

export function buildDeepAnalytics(cases: StoredCase[], opts?: { minJudgeCases?: number }): DeepAnalytics {
  const minJ = opts?.minJudgeCases ?? 5;
  const fi = cases.filter((c) => c.enrichedAt && isFi(c.caseNumber));
  const appeal = cases.filter((c) => c.enrichedAt && isAppeal(c.caseNumber));
  const enriched = cases.filter((c) => c.enrichedAt);
  const notes: string[] = [
    "Скорость: середина числа дней от поступления дела до результата или даты акта (первая инстанция).",
    "Отмены: доля апелляций с исходом «отменено / изменено» среди дел 11-* с известным исходом; судья — из первой инстанции, если указан.",
    "Банки: доля удовлетворений по делам, где истец похож на банк.",
    "Суммы вытаскиваются из текста актов автоматически — возможны ошибки и шум.",
  ];

  // --- judges ---
  type Acc = {
    name: string;
    cases: number;
    durations: number[];
    known: number;
    fav: number;
    den: number;
    bank: number;
    bankFav: number;
    appealRev: number;
    appealCh: number;
  };
  const judges = new Map<string, Acc>();
  const touch = (name: string): Acc => {
    let a = judges.get(name);
    if (!a) {
      a = {
        name, cases: 0, durations: [], known: 0, fav: 0, den: 0,
        bank: 0, bankFav: 0, appealRev: 0, appealCh: 0,
      };
      judges.set(name, a);
    }
    return a;
  };

  for (const c of fi) {
    const jn = judgeName(c);
    if (!jn) continue;
    const a = touch(jn);
    a.cases++;
    const dur = durationDays(c);
    if (dur != null) a.durations.push(dur);
    const label = outcomeOf(c);
    if (label !== "unknown") {
      a.known++;
      if (isPlaintiffFavorable(label)) a.fav++;
      if (isDenied(label)) a.den++;
    }
    const pl = c.plaintiff ?? "";
    if (BANK_RE.test(pl)) {
      a.bank++;
      if (isPlaintiffFavorable(label)) a.bankFav++;
    }
  }

  for (const c of appeal) {
    const fiJudge = c.firstInstance?.judge?.replace(/\s+/g, " ").trim() || judgeName(c);
    if (!fiJudge) continue;
    const label = outcomeOf(c);
    if (label !== "appealed_upheld" && label !== "appealed_changed") continue;
    const a = touch(fiJudge);
    a.appealRev++;
    if (label === "appealed_changed") a.appealCh++;
  }

  const maxCases = Math.max(1, ...[...judges.values()].map((j) => j.cases));
  const judgeRows: JudgeDeepRow[] = [...judges.values()]
    .filter((j) => j.cases >= minJ || j.appealRev >= 3)
    .map((j) => ({
      name: j.name,
      cases: j.cases,
      withDuration: j.durations.length,
      medianDays: median(j.durations),
      p75Days: percentile(j.durations, 0.75),
      knownOutcomes: j.known,
      plaintiffFavorable: j.fav,
      denied: j.den,
      plaintiffFavorRate: j.known ? j.fav / j.known : null,
      bankCases: j.bank,
      bankFavorable: j.bankFav,
      bankFavorRate: j.bank ? j.bankFav / j.bank : null,
      appealReviewed: j.appealRev,
      appealChanged: j.appealCh,
      appealChangeRate: j.appealRev ? j.appealCh / j.appealRev : null,
      intensity: j.cases / maxCases,
    }))
    .sort((a, b) => b.cases - a.cases)
    .slice(0, 40);

  // --- seasonality ---
  const seasonMap = new Map<number, SeasonMonth>();
  for (let m = 1; m <= 12; m++) {
    seasonMap.set(m, {
      month: m, label: MONTH_LABELS[m]!, total: 0,
      communal: 0, divorce: 0, dtp: 0, credit: 0, other: 0,
    });
  }
  for (const c of fi) {
    const dt = parseRuDate(c.entryDate);
    if (!dt) continue;
    const cell = seasonMap.get(dt.getMonth() + 1)!;
    cell.total++;
    cell[seasonBucket(c)]++;
  }
  const seasonality = [...seasonMap.values()];

  // --- lifecycle ---
  const durs = fi.map(durationDays).filter((n): n is number => n != null);
  const lifecycle: LifecycleStats = {
    sampleSize: durs.length,
    medianDays: median(durs),
    p25Days: percentile(durs, 0.25),
    p75Days: percentile(durs, 0.75),
    meanDays: mean(durs),
  };

  // --- amounts ---
  const claims: number[] = [];
  const awards: number[] = [];
  const conversions: number[] = [];
  let both = 0;
  for (const c of fi) {
    if (!c.hasActText) continue;
    const { claim, award } = extractAmounts(actText(c));
    if (claim != null) claims.push(claim);
    if (award != null) awards.push(award);
    if (claim != null && award != null && claim > 0) {
      both++;
      conversions.push(Math.min(award / claim, 5));
    }
  }
  const amounts: AmountConversion = {
    casesWithClaim: claims.length,
    casesWithAward: awards.length,
    casesWithBoth: both,
    medianClaim: median(claims),
    medianAward: median(awards),
    medianConversion: median(conversions),
    totalClaim: claims.reduce((a, b) => a + b, 0),
    totalAward: awards.reduce((a, b) => a + b, 0),
  };

  // --- serial plaintiffs ---
  type PlAcc = {
    name: string;
    display: string;
    cases: number;
    known: number;
    wins: number;
    losses: number;
    samples: string[];
  };
  const plaintiffs = new Map<string, PlAcc>();
  for (const c of fi) {
    const raw = (c.plaintiff ?? "").trim();
    if (raw.length < 3) continue;
    const key = normalizeName(raw).slice(0, 120);
    if (key.length < 3) continue;
    let a = plaintiffs.get(key);
    if (!a) {
      a = { name: key, display: raw.slice(0, 100), cases: 0, known: 0, wins: 0, losses: 0, samples: [] };
      plaintiffs.set(key, a);
    }
    a.cases++;
    if (a.samples.length < 4) a.samples.push(c.caseNumber);
    const label = outcomeOf(c);
    if (label === "unknown") continue;
    a.known++;
    if (isPlaintiffFavorable(label)) a.wins++;
    else if (isDenied(label)) a.losses++;
  }
  const serialPlaintiffs: SerialPlaintiff[] = [...plaintiffs.values()]
    .filter((p) => p.cases >= 4)
    .map((p) => ({
      name: p.display,
      cases: p.cases,
      knownOutcomes: p.known,
      wins: p.wins,
      losses: p.losses,
      winRate: p.wins + p.losses > 0 ? p.wins / (p.wins + p.losses) : null,
      kind: partyKind(p.display),
      sampleCaseNumbers: p.samples,
    }))
    .sort((a, b) => b.cases - a.cases)
    .slice(0, 30);

  // --- stuck unknown ---
  const now = new Date();
  const stuckUnknown: StuckCase[] = [];
  for (const c of fi) {
    const label = outcomeOf(c);
    if (label !== "unknown") continue;
    const entry = parseRuDate(c.entryDate);
    const age = entry ? daysBetween(entry, now) : null;
    if (age != null && age < 60) continue;
    if (c.resultDate && !c.hasActText) continue;
    stuckUnknown.push({
      caseNumber: c.caseNumber,
      court: c.courtSubdomain,
      judge: judgeName(c) ?? undefined,
      entryDate: c.entryDate,
      ageDays: age,
      status: c.status?.slice(0, 80),
      hasActText: c.hasActText,
    });
  }
  stuckUnknown.sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0));
  const stuckTop = stuckUnknown.slice(0, 40);

  // --- practice shift (by entry month) ---
  const practice = new Map<string, { total: number; known: number; granted: number; denied: number }>();
  for (const c of fi) {
    const dt = parseRuDate(c.entryDate) ?? parseRuDate(c.resultDate);
    if (!dt) continue;
    const ym = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    let a = practice.get(ym);
    if (!a) {
      a = { total: 0, known: 0, granted: 0, denied: 0 };
      practice.set(ym, a);
    }
    a.total++;
    const label = outcomeOf(c);
    if (label === "unknown") continue;
    a.known++;
    if (isPlaintiffFavorable(label)) a.granted++;
    if (isDenied(label)) a.denied++;
  }
  const practiceShift: PracticeMonth[] = [...practice.entries()]
    .map(([ym, a]) => ({
      ym,
      total: a.total,
      known: a.known,
      granted: a.granted,
      denied: a.denied,
      grantedRate: a.known ? a.granted / a.known : null,
    }))
    .sort((a, b) => a.ym.localeCompare(b.ym))
    .slice(-36);

  return {
    judges: judgeRows,
    seasonality,
    lifecycle,
    amounts,
    serialPlaintiffs,
    stuckUnknown: stuckTop,
    practiceShift,
    notes,
  };
}
