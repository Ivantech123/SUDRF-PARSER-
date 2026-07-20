export interface CategoryFacet {
  name: string;
  count: number;
}

export interface CategoryGroup {
  id: string;
  label: string;
  items: CategoryFacet[];
  total: number;
}

const GROUP_RULES: Array<{ id: string; label: string; test: (name: string) => boolean }> = [
  { id: "civil", label: "Гражданские", test: (n) => /граждан|спор|иск|экон|банкрот|семейн|трудов|жилищ/i.test(n) },
  { id: "criminal", label: "Уголовные", test: (n) => /уголов/i.test(n) },
  { id: "admin", label: "Административные", test: (n) => /админ/i.test(n) },
  { id: "appeal", label: "Апелляция и кассация", test: (n) => /апелляц|кассац/i.test(n) },
];

export function groupCategories(categories: CategoryFacet[]): CategoryGroup[] {
  const buckets = new Map<string, CategoryGroup>();
  for (const rule of GROUP_RULES) {
    buckets.set(rule.id, { id: rule.id, label: rule.label, items: [], total: 0 });
  }
  const other: CategoryGroup = { id: "other", label: "Прочее", items: [], total: 0 };

  for (const cat of categories) {
    const rule = GROUP_RULES.find((r) => r.test(cat.name));
    const bucket = rule ? buckets.get(rule.id)! : other;
    bucket.items.push(cat);
    bucket.total += cat.count;
  }

  const groups = [...buckets.values(), other].filter((g) => g.items.length > 0);
  for (const g of groups) {
    g.items.sort((a, b) => b.count - a.count);
  }
  return groups.sort((a, b) => b.total - a.total);
}

export interface CaseSearchFilters {
  caseNumber: string;
  uid: string;
  participant: string;
  /** all | representative | plaintiff | defendant | third | judge */
  participantRole: string;
  judge: string;
  court: string;
  region: string;
  category: string;
  categoryGroup: string;
  onlyWithDocuments: boolean;
  onlyEnriched: boolean;
  /** ISO YYYY-MM-DD */
  hearingFrom: string;
  /** ISO YYYY-MM-DD */
  hearingTo: string;
}

/** Default catalog scope — empty shows all regions; set via build/env if needed. */
export const DISPLAY_REGION = "";

export const EMPTY_FILTERS: CaseSearchFilters = {
  caseNumber: "",
  uid: "",
  participant: "",
  participantRole: "all",
  judge: "",
  court: "all",
  region: DISPLAY_REGION,
  category: "all",
  categoryGroup: "all",
  onlyWithDocuments: false,
  onlyEnriched: false,
  hearingFrom: "",
  hearingTo: "",
};

export const PARTICIPANT_ROLE_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "all", label: "Любая роль" },
  { id: "representative", label: "ПРЕДСТАВИТЕЛЬ" },
  { id: "plaintiff", label: "Истец" },
  { id: "defendant", label: "Ответчик" },
  { id: "third", label: "Третье лицо" },
  { id: "judge", label: "Судья" },
];

export function categoryMatchesGroup(name: string, groupId: string): boolean {
  const rule = GROUP_RULES.find((r) => r.id === groupId);
  if (!rule) return groupId === "other" && !GROUP_RULES.some((r) => r.test(name));
  return rule.test(name);
}

export function hasActiveFilters(f: CaseSearchFilters): boolean {
  return Boolean(
    f.caseNumber.trim()
    || f.uid.trim()
    || f.participant.trim()
    || (f.participantRole && f.participantRole !== "all")
    || f.judge.trim()
    || f.court !== "all"
    || (f.region !== "all" && f.region !== DISPLAY_REGION)
    || f.category !== "all"
    || f.categoryGroup !== "all"
    || f.onlyWithDocuments
    || f.onlyEnriched
    || f.hearingFrom.trim()
    || f.hearingTo.trim(),
  );
}

export function countActiveFilters(f: CaseSearchFilters): number {
  let n = 0;
  if (f.caseNumber.trim()) n++;
  if (f.uid.trim()) n++;
  if (f.participant.trim()) n++;
  if (f.participantRole && f.participantRole !== "all") n++;
  if (f.judge.trim()) n++;
  if (f.court !== "all") n++;
  if (f.region !== "all" && f.region !== DISPLAY_REGION) n++;
  if (f.category !== "all") n++;
  if (f.categoryGroup !== "all") n++;
  if (f.onlyWithDocuments) n++;
  if (f.onlyEnriched) n++;
  if (f.hearingFrom.trim()) n++;
  if (f.hearingTo.trim() && f.hearingTo !== f.hearingFrom) n++;
  return n;
}

export interface CourtFacet {
  subdomain: string;
  name: string;
  region?: string;
  count: number;
}

export function groupCourtsByRegion(courts: CourtFacet[]): Array<{ region: string; courts: CourtFacet[] }> {
  const by = new Map<string, CourtFacet[]>();
  for (const c of courts) {
    const region = c.region?.trim() || "Без региона";
    const list = by.get(region) ?? [];
    list.push(c);
    by.set(region, list);
  }
  return [...by.entries()]
    .map(([region, items]) => ({
      region,
      courts: items.sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => {
      const sum = (xs: CourtFacet[]) => xs.reduce((s, c) => s + c.count, 0);
      return sum(b.courts) - sum(a.courts);
    });
}
