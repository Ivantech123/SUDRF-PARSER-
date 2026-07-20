/**
 * Normalizer for personal-name fields (parties / representatives / judges).
 * Stop-dictionary markers → null + nameStatus "depersonalized" (TZ P0, 20.07.2026).
 */

export type NameStatus = "identified" | "depersonalized" | "empty";

export interface NormalizedPersonName {
  /** Clean display name, or null when empty/depersonalized. */
  name: string | null;
  nameStatus: NameStatus;
}

/** Literal / phrase markers (case-insensitive, trimmed). */
const STOP_PHRASES = [
  "информация скрыта",
  "данные изъяты",
  "<данные изъяты>",
  "<адрес>",
  "<дата>",
  "не указано",
  "не указан",
  "не указана",
  "неизвестно",
  "нет данных",
  "фио",
  "ф.и.о.",
  "ф.и.о",
  "—",
  "-",
  "–",
  "…",
  "...",
];

/** ФИО / ФИО1 / Ф.И.О. 3 */
const FIO_TOKEN = /^(?:фио|ф\.?\s*и\.?\s*о\.?)[\s№#.\-]*\d*$/i;

/** Only initials like Л.С.В. or Л. С. В. */
const INITIALS_ONLY = /^[А-ЯЁ]\.\s*[А-ЯЁ]\.\s*[А-ЯЁ]\.?$/i;

/** Case-number-like values wrongly put in name fields */
const CASE_NUMBERISH =
  /^(?:\d{1,2}[аa]?[-\/|]\d+(?:[\/|]\d{2,4})?|\d{1,2}[аa]?-\d+[\/|]\d{4})$/i;

const STOP_SET = new Set(STOP_PHRASES);

function collapse(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** True if the value must not enter person graphs / lawyer cards. */
export function isDepersonalizedMarker(raw: string | null | undefined): boolean {
  if (raw == null) return true;
  const n = collapse(String(raw));
  if (!n) return true;
  const lower = n.toLowerCase();
  if (STOP_SET.has(lower)) return true;
  if (FIO_TOKEN.test(n.replace(/\s/g, "")) || FIO_TOKEN.test(n)) return true;
  if (/фио\s*\d+/i.test(n) || /\bфио\d+\b/i.test(n)) return true;
  if (INITIALS_ONLY.test(n)) return true;
  if (CASE_NUMBERISH.test(n)) return true;
  // Angle-bracket placeholders: <…>
  if (/^<[^>]{1,40}>$/i.test(n)) return true;
  return false;
}

export function normalizePersonName(raw: string | null | undefined): NormalizedPersonName {
  if (raw == null) return { name: null, nameStatus: "empty" };
  const n = collapse(String(raw));
  if (!n) return { name: null, nameStatus: "empty" };
  if (isDepersonalizedMarker(n)) {
    return { name: null, nameStatus: "depersonalized" };
  }
  return { name: n, nameStatus: "identified" };
}
