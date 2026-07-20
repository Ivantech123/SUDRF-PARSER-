// Aggregate representative win-rate from enriched first-instance cases.

import type { StoredCase } from "../cases/store.js";
import { classifyName, isRepresentativeRole } from "./depersonalization.js";
import { classifyOutcome, type OutcomeLabel } from "./outcome.js";

export type Side = "plaintiff" | "defendant" | "unknown";

const WIN_FOR_PLAINTIFF = new Set<OutcomeLabel>(["granted", "granted_partial"]);
const WIN_FOR_DEFENDANT = new Set<OutcomeLabel>(["denied"]);
const NEUTRAL = new Set<OutcomeLabel>(["settled", "terminated", "returned", "unknown"]);

export interface RepStat {
  name: string;
  cases: number;
  withOutcome: number;
  wins: number;
  losses: number;
  neutrals: number;
  winRate: number | null;
  courts: string[];
  sampleCaseNumbers: string[];
}

function normRepName(raw: string): string | null {
  const kind = classifyName(raw);
  if (kind !== "identifiable") return null;
  return raw.replace(/\s+/g, " ").trim();
}

function repsFromCase(c: StoredCase): string[] {
  const names = new Set<string>();
  for (const p of c.participants ?? []) {
    if (!isRepresentativeRole(p.role)) continue;
    const n = normRepName(p.name);
    if (n) names.add(n);
  }
  const text = c.documents.map((d) => d.text ?? "").join("\n");
  const re =
    /(?:адвокат|представител(?:ь|я|ем|ю)|защитник|юрисконсульт)\s*[:\s—-]+\s*([А-ЯЁA-Zа-яёa-z.\-\s]{5,80}?)(?=[,;.]|\n|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const chunk = (m[1] ?? "").replace(/\s+/g, " ").trim().split(/\s+/).slice(0, 4).join(" ");
    const n = normRepName(chunk);
    if (n) names.add(n);
  }
  return [...names];
}

function score(label: OutcomeLabel): "win" | "loss" | "neutral" {
  // Without reliable side detection, treat plaintiff-favorable as win and
  // denial as loss — typical for plaintiff-side counsel; flagged in report.
  if (WIN_FOR_PLAINTIFF.has(label)) return "win";
  if (WIN_FOR_DEFENDANT.has(label)) return "loss";
  if (NEUTRAL.has(label)) return "neutral";
  return "neutral";
}

export function buildWinrateReport(
  cases: StoredCase[],
  opts?: { minCases?: number },
): {
  totalCases: number;
  withIdentifiableRep: number;
  withKnownOutcome: number;
  caveat: string;
  leaders: RepStat[];
} {
  const minCases = opts?.minCases ?? 2;
  const acc = new Map<string, RepStat>();

  let withIdentifiableRep = 0;
  let withKnownOutcome = 0;

  for (const c of cases) {
    const reps = repsFromCase(c);
    if (!reps.length) continue;
    withIdentifiableRep++;

    const outcome = classifyOutcome({
      status: c.status,
      events: c.events,
      documentText: c.documents.map((d) => d.text ?? "").join("\n"),
    });
    const known = outcome.label !== "unknown";
    if (known) withKnownOutcome++;
    const bucket = known ? score(outcome.label) : "neutral";

    for (const name of reps) {
      const key = name.toLowerCase();
      let s = acc.get(key);
      if (!s) {
        s = {
          name,
          cases: 0,
          withOutcome: 0,
          wins: 0,
          losses: 0,
          neutrals: 0,
          winRate: null,
          courts: [],
          sampleCaseNumbers: [],
        };
        acc.set(key, s);
      }
      s.cases++;
      if (known) s.withOutcome++;
      if (bucket === "win") s.wins++;
      else if (bucket === "loss") s.losses++;
      else s.neutrals++;
      if (!s.courts.includes(c.courtSubdomain)) s.courts.push(c.courtSubdomain);
      if (s.sampleCaseNumbers.length < 5) s.sampleCaseNumbers.push(c.caseNumber);
    }
  }

  const leaders = [...acc.values()]
    .map((s) => {
      const decided = s.wins + s.losses;
      return {
        ...s,
        winRate: decided > 0 ? s.wins / decided : null,
      };
    })
    .filter((s) => s.cases >= minCases)
    .sort((a, b) => b.cases - a.cases || (b.winRate ?? -1) - (a.winRate ?? -1));

  return {
    totalCases: cases.length,
    withIdentifiableRep,
    withKnownOutcome,
    caveat:
      "Победа = исход в пользу истца (удовлетворено / частично), поражение = отказ. Пока нет надёжной связи «представитель → чья сторона», показатель ориентировочный.",
    leaders,
  };
}
