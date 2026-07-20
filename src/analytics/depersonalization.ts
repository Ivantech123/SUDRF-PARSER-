// Measure how often court-published texts keep identifiable representative names
// after ФЗ-262 depersonalization (ФИО1 / ФИО2 / …).

import type { CaseDetails, CaseParticipant } from "../sudrf/types.js";
import type { StoredCase } from "../cases/store.js";
import { isDepersonalizedMarker } from "./person-name.js";

export type NameKind = "identifiable" | "depersonalized" | "empty" | "org";

export interface NameVerdict {
  raw: string;
  kind: NameKind;
  source: "participants" | "document_text";
  roleHint?: string;
}

export interface CaseDepersonalization {
  caseId: string;
  caseNumber: string;
  courtSubdomain: string;
  hasDocuments: boolean;
  hasActText: boolean;
  representativesInCard: NameVerdict[];
  representativesInText: NameVerdict[];
  /** True if at least one identifiable representative name survives. */
  representativeIdentifiable: boolean;
  /** Card lists a representative role but every name is ФИОN / empty. */
  representativeOnlyDepersonalized: boolean;
  /** No representative role in card and none extracted from act text. */
  noRepresentativeFound: boolean;
}

export interface DepersonalizationReport {
  sampleSize: number;
  withActText: number;
  withRepresentativeSignal: number;
  identifiable: number;
  onlyDepersonalized: number;
  noRepresentative: number;
  /** identifiable / withRepresentativeSignal (0..1), or null if no signal. */
  identifiableRate: number | null;
  goNoGo: "go" | "borderline" | "no-go" | "insufficient";
  cases: CaseDepersonalization[];
}

const REPRESENTATIVE_ROLE =
  /адвокат|представ|защитник|юрисконсульт|пов\.?\s*защит/i;

const ORG_HINT =
  /ооо|ао|пао|зао|ип\b|гуп|муп|фгуп|нко|банк|страх|фонд|министер|управлен|комитет|администрац|прокурат|следственн|мвд|фссп|гибдд|суд\b/i;

/** Фамилия Имя Отчество or Фамилия И.О. */
const PERSON_FIO =
  /^[А-ЯЁA-Z][а-яёa-z\-]+(?:\s+[А-ЯЁA-Z][а-яёa-z\-]+){1,2}$/;
const PERSON_INITIALS =
  /^[А-ЯЁA-Z][а-яёa-z\-]+\s+[А-ЯЁA-Z]\.\s*[А-ЯЁA-Z]\.?$/;
const PERSON_INITIALS_FRONT =
  /^[А-ЯЁA-Z]\.\s*[А-ЯЁA-Z]\.\s+[А-ЯЁA-Z][а-яёa-z\-]+$/;

const TEXT_LAWYER =
  /(?:адвокат|представител(?:ь|я|ем|ю)|защитник|юрисконсульт)\s*[:\s—-]+\s*([А-ЯЁA-Zа-яёa-z.\-\s]{5,80}?)(?=[,;.]|\n|$)/gi;

export function classifyName(raw: string): NameKind {
  const n = raw.replace(/\s+/g, " ").trim();
  if (!n) return "empty";
  if (isDepersonalizedMarker(n)) return "depersonalized";
  if (ORG_HINT.test(n)) return "org";
  if (PERSON_FIO.test(n) || PERSON_INITIALS.test(n) || PERSON_INITIALS_FRONT.test(n)) {
    return "identifiable";
  }
  // Soft: two+ Cyrillic tokens, first capitalized, not a role word alone
  if (/^[А-ЯЁ][а-яё\-]+(?:\s+[А-ЯЁа-яё.\-]+){1,3}$/.test(n) && n.length >= 6) {
    return "identifiable";
  }
  return "empty";
}

export function isRepresentativeRole(role: string): boolean {
  return REPRESENTATIVE_ROLE.test(role);
}

function verdictFromParticipant(p: CaseParticipant): NameVerdict | null {
  if (!isRepresentativeRole(p.role)) return null;
  return {
    raw: p.name,
    kind: classifyName(p.name),
    source: "participants",
    roleHint: p.role,
  };
}

function lawyersFromText(text: string): NameVerdict[] {
  const out: NameVerdict[] = [];
  const re = new RegExp(TEXT_LAWYER.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const chunk = (m[1] ?? "")
      .replace(/\s+/g, " ")
      .replace(/^(?:г-н|г-жа|гражданин|гражданка)\s+/i, "")
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .join(" ");
    if (!chunk) continue;
    out.push({
      raw: chunk,
      kind: classifyName(chunk),
      source: "document_text",
      roleHint: m[0]?.split(/[:\s—-]/)[0],
    });
  }
  return out;
}

export function analyzeCaseDetails(
  details: CaseDetails,
  meta: { caseId: string; courtSubdomain: string },
): CaseDepersonalization {
  const card = (details.participants ?? [])
    .map(verdictFromParticipant)
    .filter((v): v is NameVerdict => v != null);

  const texts = (details.documents ?? []).map((d) => d.text ?? "").filter(Boolean);
  const fromText = texts.flatMap(lawyersFromText);

  return summarize(meta.caseId, details.caseNumber, meta.courtSubdomain, card, fromText, {
    hasDocuments: (details.documents?.length ?? 0) > 0,
    hasActText: texts.some((t) => t.trim().length > 40),
  });
}

export function analyzeStoredCase(c: StoredCase): CaseDepersonalization {
  const card = (c.participants ?? [])
    .map(verdictFromParticipant)
    .filter((v): v is NameVerdict => v != null);

  const texts = (c.documents ?? []).map((d) => d.text ?? "").filter(Boolean);
  const fromText = texts.flatMap(lawyersFromText);

  return summarize(c.id, c.caseNumber, c.courtSubdomain, card, fromText, {
    hasDocuments: c.documentsCount > 0 || c.documents.length > 0,
    hasActText: c.hasActText || texts.some((t) => t.trim().length > 40),
  });
}

function summarize(
  caseId: string,
  caseNumber: string,
  courtSubdomain: string,
  card: NameVerdict[],
  fromText: NameVerdict[],
  flags: { hasDocuments: boolean; hasActText: boolean },
): CaseDepersonalization {
  const all = [...card, ...fromText];
  const identifiable = all.some((v) => v.kind === "identifiable");
  const hasSignal = all.length > 0;
  const onlyDep =
    hasSignal &&
    !identifiable &&
    all.every((v) => v.kind === "depersonalized" || v.kind === "empty" || v.kind === "org");

  return {
    caseId,
    caseNumber,
    courtSubdomain,
    hasDocuments: flags.hasDocuments,
    hasActText: flags.hasActText,
    representativesInCard: card,
    representativesInText: fromText,
    representativeIdentifiable: identifiable,
    representativeOnlyDepersonalized: onlyDep,
    noRepresentativeFound: !hasSignal,
  };
}

/**
 * go ≥ 40% identifiable among cases with a representative signal;
 * borderline 20–40%; no-go < 20%.
 * Need ≥ 40 signaled cases for a firm call; 20–39 → provisional (same labels, smaller n).
 */
export function buildReport(cases: CaseDepersonalization[]): DepersonalizationReport {
  const withActText = cases.filter((c) => c.hasActText).length;
  // "with signal" = card or act text mentioned a representative role/name
  const signaled = cases.filter((c) => !c.noRepresentativeFound);
  const identifiable = cases.filter((c) => c.representativeIdentifiable).length;
  const onlyDepersonalized = cases.filter((c) => c.representativeOnlyDepersonalized).length;
  const noRepresentative = cases.filter((c) => c.noRepresentativeFound).length;
  const rate = signaled.length ? identifiable / signaled.length : null;

  let goNoGo: DepersonalizationReport["goNoGo"] = "insufficient";
  if (signaled.length >= 20 && rate != null) {
    if (rate >= 0.4) goNoGo = "go";
    else if (rate >= 0.2) goNoGo = "borderline";
    else goNoGo = "no-go";
  }

  return {
    sampleSize: cases.length,
    withActText,
    withRepresentativeSignal: signaled.length,
    identifiable,
    onlyDepersonalized,
    noRepresentative,
    identifiableRate: rate,
    goNoGo,
    cases,
  };
}
