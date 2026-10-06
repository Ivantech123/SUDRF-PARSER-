// Legal entity name normalization for deduplication (ООО "Ромашка" ≈ ООО Ромашка).

/**
 * Legal forms, longest-first so "ФГУП" wins over "ГУП" and "ПАО" over "АО".
 * Single source of truth for both detection and stripping — the two used to be
 * separate lists and had already drifted apart.
 */
const OPF_FORMS = [
  "фгуп", "фгбу", "оао", "пао", "зао", "нао", "ано", "ооо", "гуп", "муп",
  "нко", "гбу", "мбу", "тсж", "снт", "ао", "ип",
].sort((a, b) => b.length - a.length);

const OPF_ALT = OPF_FORMS.join("|");

/**
 * JS `\b` is ASCII-only, so it never fires after a Cyrillic letter: the old
 * /^(ооо|…)\b/ matched nothing and every company silently lost its legal form
 * (canonical "Ромашка" instead of "ООО Ромашка", opf always undefined).
 * Assert "not followed by another letter" instead.
 */
const OPF_PREFIX_RE = new RegExp(`^(${OPF_ALT})(?![а-яёa-z])`, "i");

/** Leading "ООО " / trailing " ООО" wrappers to drop from the match key. */
const OPF_STRIP_RES = [
  new RegExp(`^(?:${OPF_ALT})(?![а-яёa-z])[\\s.,-]*`, "i"),
  new RegExp(`[\\s.,-]+(?:${OPF_ALT})$`, "i"),
];

/**
 * Court cards mix abbreviations with the spelled-out form, so the same company
 * arrives as both 'ООО "Голиаф"' and 'Общество с ограниченной
 * ответственностью "Голиаф"'. Fold the long forms onto the abbreviation or the
 * two never share a match key and dedup splits the company in two.
 * Specific forms first: "публичное акционерное общество" must win over the
 * bare "акционерное общество".
 */
const OPF_LONG_FORMS: Array<[RegExp, string]> = [
  [/^федеральное\s+государственное\s+унитарное\s+предприятие/i, "ФГУП"],
  [/^государственное\s+унитарное\s+предприятие/i, "ГУП"],
  [/^муниципальное\s+унитарное\s+предприятие/i, "МУП"],
  [/^общество\s+с\s+ограниченной\s+ответственностью/i, "ООО"],
  [/^публичное\s+акционерное\s+общество/i, "ПАО"],
  [/^закрытое\s+акционерное\s+общество/i, "ЗАО"],
  [/^открытое\s+акционерное\s+общество/i, "ОАО"],
  [/^непубличное\s+акционерное\s+общество/i, "НАО"],
  [/^акционерное\s+общество/i, "АО"],
  [/^индивидуальный\s+предприниматель/i, "ИП"],
  [/^автономная\s+некоммерческая\s+организация/i, "АНО"],
  [/^товарищество\s+собственников\s+жилья/i, "ТСЖ"],
];

const QUOTE_RE = /[«»"""'']/g;

export interface NormalizedEntity {
  /** Display form: ООО Ромашка */
  canonical: string;
  /** Match key: ромашка (lowercase, no OPF, no quotes) */
  key: string;
  /** Detected legal form if any */
  opf?: string;
  raw: string;
}

function detectOpf(s: string): string | undefined {
  for (const [re, abbr] of OPF_LONG_FORMS) {
    if (re.test(s)) return abbr;
  }
  const m = s.match(OPF_PREFIX_RE);
  return m ? m[1]!.toUpperCase() : undefined;
}

function stripOpf(s: string): string {
  let out = s.trim();
  for (const [re] of OPF_LONG_FORMS) {
    const stripped = out.replace(re, " ").trim();
    if (stripped !== out) { out = stripped; break; }
  }
  for (const re of OPF_STRIP_RES) {
    out = out.replace(re, " ").trim();
  }
  return out.replace(/^[\s.,-]+/, "").replace(/\s+/g, " ");
}

/** Normalize a party/company name to a canonical form. */
export function normalizeEntityName(raw: string): NormalizedEntity | null {
  const trimmed = raw?.trim();
  if (!trimmed || trimmed.length < 2) return null;

  const noQuotes = trimmed.replace(QUOTE_RE, "").replace(/\s+/g, " ").trim();
  const opf = detectOpf(noQuotes);
  const core = stripOpf(noQuotes);
  if (!core || core.length < 2) return null;

  const key = core.toLowerCase();
  const canonical = opf ? `${opf} ${core}` : core;

  return { canonical, key, opf, raw: trimmed };
}

/** Split compound party strings (plaintiff vs defendant lists). */
export function extractEntityCandidates(text: string): string[] {
  if (!text?.trim()) return [];
  return text
    .split(/[;/|,]|\s+-\s+|(?:\s+и\s+)/i)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2 && !/^\d+$/.test(p));
}
