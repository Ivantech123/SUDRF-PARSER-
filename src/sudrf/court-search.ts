// Court registry search — token/word-aware matching with region hints.
// Replaces naive substring includes() which matched «Саранск» → Табасаранский.

import { COURT_REGISTRY, type CourtEntry } from "./courts.js";

export interface CourtSearchHit extends CourtEntry {
  score: number;
  matchReason: string;
}

const STOPWORDS = new Set([
  "суд", "районный", "городской", "межрайонный", "мировой", "участок",
  "г", "города", "город", "области", "область", "края", "край",
  "республики", "республика", "рф", "рф.", "первой", "инстанции",
]);

// Region / city hints → region code in registry (subject RF).
const REGION_HINTS: Array<{ re: RegExp; region: string; label: string }> = [
  { re: /мордов/i, region: "13", label: "Мордовия" },
  { re: /саранск/i, region: "13", label: "Саранск" },
  { re: /адыге/i, region: "1", label: "Адыгея" },
  { re: /башкорт|уф[ае]/i, region: "2", label: "Башкортостан" },
  { re: /дагестан/i, region: "5", label: "Дагестан" },
  { re: /москв/i, region: "77", label: "Москва" },
  { re: /петербург|спб|ленинград/i, region: "78", label: "СПб" },
];

function norm(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

function tokens(query: string): string[] {
  return norm(query)
    .split(/[^a-zа-яё0-9]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

// Whole-word (or prefix for geo names ≥5 chars) match inside court name.
function wordMatches(name: string, token: string): boolean {
  const n = norm(name);
  if (n.includes(token)) {
    // Reject substring-in-word false positives: token must align on word boundary.
    const re = new RegExp(
      `(?:^|[^a-zа-яё0-9])${escapeRe(token)}(?:[^a-zа-яё0-9]|$)|^${escapeRe(token)}(?:[^a-zа-яё0-9]|$)`,
      "i"
    );
    if (re.test(n)) return true;
    // Prefix match for inflected city names: «саранск» ↔ «саранска».
    if (token.length >= 5) {
      const words = n.split(/[^a-zа-яё0-9]+/i).filter(Boolean);
      if (words.some((w) => w.startsWith(token) || token.startsWith(w))) return true;
    }
  }
  return false;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function regionHints(query: string): string[] {
  const out: string[] = [];
  for (const h of REGION_HINTS) {
    if (h.re.test(query)) out.push(h.region);
  }
  return out;
}

function scoreCourt(court: CourtEntry, query: string, toks: string[], hintedRegions: string[]): { score: number; reason: string } {
  const name = norm(court.name);
  const q = norm(query);
  let score = 0;
  const reasons: string[] = [];

  if (court.subdomain === q || court.vnkod.toLowerCase() === q) {
    return { score: 1000, reason: "exact subdomain/vnkod" };
  }

  if (name === q) {
    score += 500;
    reasons.push("exact name");
  } else if (name.includes(q) && q.length >= 8) {
    score += 200;
    reasons.push("full phrase in name");
  }

  let matched = 0;
  for (const t of toks) {
    if (wordMatches(court.name, t)) {
      matched++;
      score += 40;
    } else if (wordMatches(court.subdomain.replace(/--/g, " "), t)) {
      matched++;
      score += 15;
    }
  }
  if (matched === toks.length && toks.length > 0) {
    score += 80;
    reasons.push("all tokens");
  }

  if (hintedRegions.includes(court.region)) {
    score += 60;
    reasons.push(`region ${court.region}`);
  }

  const rank: Record<string, number> = { oblsud: 5, vs: 4, ray: 3, garb: 2, other: 1 };
  if (toks.length <= 2 && !/суд|район|город/i.test(q)) {
    score += rank[court.type] ?? 0;
  }

  if (score === 0) return { score: 0, reason: "" };
  return { score, reason: reasons.join(", ") || `${matched}/${toks.length} tokens` };
}

/** Ranked court search — returns up to `limit` candidates. */
export function searchCourts(query: string, limit = 10): CourtSearchHit[] {
  const q = query.trim();
  if (!q) return [];

  const bySub = COURT_REGISTRY.find((c) => c.subdomain === norm(q));
  if (bySub) return [{ ...bySub, score: 1000, matchReason: "exact subdomain" }];

  const byVnkod = COURT_REGISTRY.find((c) => c.vnkod.toLowerCase() === norm(q));
  if (byVnkod) return [{ ...byVnkod, score: 1000, matchReason: "exact vnkod" }];

  const toks = tokens(q);
  const hints = regionHints(q);
  const hits: CourtSearchHit[] = [];

  for (const court of COURT_REGISTRY) {
    const { score, reason } = scoreCourt(court, q, toks, hints);
    if (score > 0) hits.push({ ...court, score, matchReason: reason });
  }

  hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ru"));
  return hits.slice(0, limit);
}

/** Best single match, or null if nothing scores above threshold. */
export function findCourt(query: string): CourtEntry | null {
  const hits = searchCourts(query, 1);
  if (!hits.length || hits[0].score < 30) return null;
  return hits[0];
}

export interface ResolveCourtResult {
  query: string;
  best: CourtEntry | null;
  candidates: CourtSearchHit[];
  ambiguous: boolean;
}

export function resolveCourtQuery(query: string): ResolveCourtResult {
  const candidates = searchCourts(query, 8);
  const best = candidates[0] ?? null;
  const ambiguous = candidates.length > 1 && candidates[0].score - candidates[1].score < 40;
  return { query, best, candidates, ambiguous };
}
