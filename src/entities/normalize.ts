// Legal entity name normalization for deduplication (ООО "Ромашка" ≈ ООО Ромашка).

const OPF_PATTERNS = [
  /^ооо\s+/i,
  /^ао\s+/i,
  /^пао\s+/i,
  /^зао\s+/i,
  /^ип\s+/i,
  /^гуп\s+/i,
  /^муп\s+/i,
  /^фгуп\s+/i,
  /^нко\s+/i,
  /\s+ооо$/i,
  /\s+ао$/i,
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
  const m = s.match(/^(ооо|ао|пао|зао|ип|гуп|муп|фгуп|нко)\b/i);
  return m ? m[1].toUpperCase() : undefined;
}

function stripOpf(s: string): string {
  let out = s.trim();
  for (const re of OPF_PATTERNS) {
    out = out.replace(re, " ").trim();
  }
  return out.replace(/\s+/g, " ");
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
