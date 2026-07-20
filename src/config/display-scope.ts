// UI/API display scope — optional federal-subject filter via env.

/** Federal subject code for UI/API filters. Empty = show all regions in catalog. */
export const DISPLAY_REGION = process.env.DISPLAY_REGION?.trim() || "";

/** Optional human labels; extend via env or leave empty for generic «Регион N». */
export const REGION_LABELS: Record<string, string> = {};

export function displayRegionLabel(code = DISPLAY_REGION): string {
  if (!code) return "Все регионы";
  return REGION_LABELS[code] ?? `Регион ${code}`;
}

/** When set, API facets and lists exclude other regions. */
export function isDisplayRegionScoped(): boolean {
  return DISPLAY_REGION.length > 0;
}
