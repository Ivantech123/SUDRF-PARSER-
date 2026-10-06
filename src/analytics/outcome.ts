// Lightweight rule-based outcome classifier for civil acts / case status fields.
// Calibrate later on Mordovia texts; keep labels stable for win-rate aggregation.

export type OutcomeLabel =
  | "granted"           // иск удовлетворён (полностью/в основном)
  | "granted_partial"   // частично
  | "denied"            // в иске отказано
  | "settled"           // мировое / отказ от иска / признание
  | "terminated"        // прекращено / оставлено без рассмотрения
  | "returned"          // возвращено / оставлено без движения
  | "appealed_upheld"   // решение оставлено без изменения
  | "appealed_changed"  // отменено / изменено
  | "unknown";

export interface OutcomeVerdict {
  label: OutcomeLabel;
  confidence: number; // 0..1
  evidence: string;
  source: "status" | "events" | "document" | "none";
}

export interface OutcomeSummary {
  total: number;
  known: number;
  byLabel: Record<OutcomeLabel, number>;
}

interface Rule {
  label: OutcomeLabel;
  re: RegExp;
  confidence: number;
  source: OutcomeVerdict["source"];
}

/** Cyrillic-aware stem tail (JS \\w is ASCII-only). */
const W = "[а-яёa-z]*";

const STATUS_RULES: Rule[] = [
  { label: "granted_partial", re: new RegExp(`частичн${W}\\s+удовлетвор|удовлетвор${W}\\s+частичн`, "i"), confidence: 0.9, source: "status" },
  { label: "granted", re: new RegExp(`иск${W}\\s+удовлетвор|удовлетвор${W}\\s+полностью|требования\\s+удовлетвор`, "i"), confidence: 0.85, source: "status" },
  { label: "denied", re: /в\s+иске\s+отказан|отказано\s+в\s+удовлетвор|отказать\s+в\s+иске/i, confidence: 0.9, source: "status" },
  { label: "settled", re: /мировое\s+соглашен|отказ\s+от\s+иска|признан[а-яё]*\s+иск/i, confidence: 0.85, source: "status" },
  { label: "terminated", re: new RegExp(`производств${W}.{0,40}прекращ|оставлен${W}\\s+без\\s+рассмотрен`, "i"), confidence: 0.85, source: "status" },
  // sudrf writes this subject-first ("Заявление возвращено заявителю") at
  // least as often as verb-first, so match both orders or returned claims
  // fall into "unknown" and skew the win-rate denominator.
  { label: "returned", re: new RegExp(`возвращ${W}\\s+(?:иск${W}\\s+)?заявлен|заявлен${W}\\s+возвращ|оставлен${W}\\s+без\\s+движен`, "i"), confidence: 0.8, source: "status" },
  { label: "appealed_changed", re: new RegExp(`отменен|изменен${W}\\s+решен`, "i"), confidence: 0.75, source: "status" },
  { label: "appealed_upheld", re: new RegExp(`оста(?:вить|влен${W})\\s+без\\s+изменен`, "i"), confidence: 0.8, source: "status" },
];

const DOC_RULES: Rule[] = [
  { label: "granted_partial", re: /удовлетворить\s+частично|требования\s+удовлетворить\s+частично/i, confidence: 0.8, source: "document" },
  { label: "granted", re: /решил(?:а)?[:\s].{0,120}удовлетворить|исковые\s+требования\s+удовлетворить/i, confidence: 0.75, source: "document" },
  { label: "denied", re: /в\s+удовлетворении\s+исков[а-яё]*\s+требований\s+отказать|отказать\s+в\s+удовлетворении/i, confidence: 0.85, source: "document" },
  { label: "settled", re: /утвердить\s+мировое\s+соглашение|принять\s+отказ\s+от\s+иска/i, confidence: 0.85, source: "document" },
  { label: "terminated", re: /прекратить\s+производств/i, confidence: 0.8, source: "document" },
  { label: "appealed_upheld", re: /решение.+оставить\s+без\s+изменения|определение.+оставить\s+без\s+изменения/i, confidence: 0.8, source: "document" },
  { label: "appealed_changed", re: /решение.+отменить|отменить\s+решение/i, confidence: 0.75, source: "document" },
];

function matchRules(text: string, rules: Rule[]): OutcomeVerdict | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return null;
  for (const rule of rules) {
    const m = t.match(rule.re);
    if (m) {
      return {
        label: rule.label,
        confidence: rule.confidence,
        evidence: m[0].slice(0, 120),
        source: rule.source,
      };
    }
  }
  return null;
}

export function classifyOutcome(input: {
  status?: string;
  events?: Array<{ name?: string; result?: string }>;
  documentText?: string;
}): OutcomeVerdict {
  const fromStatus = matchRules(input.status ?? "", STATUS_RULES);
  if (fromStatus) return fromStatus;

  const eventBlob = (input.events ?? [])
    .map((e) => [e.name, e.result].filter(Boolean).join(" "))
    .join(" | ");
  const fromEvents = matchRules(eventBlob, STATUS_RULES.map((r) => ({ ...r, source: "events" as const })));
  if (fromEvents) return fromEvents;

  // Prefer the tail of the act (резолютивная часть)
  const doc = input.documentText ?? "";
  const tail = doc.length > 2500 ? doc.slice(-2500) : doc;
  const fromDoc = matchRules(tail, DOC_RULES);
  if (fromDoc) return fromDoc;

  return { label: "unknown", confidence: 0, evidence: "", source: "none" };
}

const EMPTY_COUNTS = (): Record<OutcomeLabel, number> => ({
  granted: 0,
  granted_partial: 0,
  denied: 0,
  settled: 0,
  terminated: 0,
  returned: 0,
  appealed_upheld: 0,
  appealed_changed: 0,
  unknown: 0,
});

export function summarizeOutcomes(verdicts: OutcomeVerdict[]): OutcomeSummary {
  const byLabel = EMPTY_COUNTS();
  for (const v of verdicts) byLabel[v.label]++;
  const total = verdicts.length;
  const known = total - byLabel.unknown;
  return { total, known, byLabel };
}
