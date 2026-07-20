// How fast the catalog grows — by collectedAt timestamps (new cards only).

import type { CaseCatalog } from "../cases/store.js";

export interface CollectionRateStats {
  newLast24h: number;
  newLast7d: number;
  /** Rolling average new cards per day over the last 7 days. */
  perDay7d: number;
  /** Rough ETA days to target at perDay7d (null if rate is 0). */
  etaDaysToTarget: number | null;
  targetCatalogSize: number;
  generatedAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeCollectionRate(
  catalog: CaseCatalog,
  opts?: { region?: string; targetSize?: number },
): CollectionRateStats {
  const now = Date.now();
  const region = opts?.region?.trim();
  const target = opts?.targetSize ?? 500_000;
  let newLast24h = 0;
  let newLast7d = 0;

  catalog.forEach((c) => {
    if (region && c.courtRegion !== region) return;
    const t = Date.parse(c.collectedAt);
    if (Number.isNaN(t)) return;
    const age = now - t;
    if (age <= DAY_MS) newLast24h++;
    if (age <= 7 * DAY_MS) newLast7d++;
  });

  const perDay7d = Math.round((newLast7d / 7) * 10) / 10;
  let scopedSize = 0;
  catalog.forEach((c) => {
    if (region && c.courtRegion !== region) return;
    scopedSize++;
  });
  const remaining = Math.max(0, target - scopedSize);
  const etaDaysToTarget =
    perDay7d > 0 ? Math.ceil(remaining / perDay7d) : null;

  return {
    newLast24h,
    newLast7d,
    perDay7d,
    etaDaysToTarget,
    targetCatalogSize: target,
    generatedAt: new Date().toISOString(),
  };
}
