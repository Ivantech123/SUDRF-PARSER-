// Entity index built from catalog participants — resolve aliases to cases.

import type { CaseCatalog, StoredCase } from "../cases/store.js";
import { extractEntityCandidates, normalizeEntityName, type NormalizedEntity } from "./normalize.js";

export interface EntityRecord {
  key: string;
  canonical: string;
  opf?: string;
  aliases: string[];
  caseIds: string[];
  caseCount: number;
  regions: string[];
  courts: string[];
}

export interface EntityResolveResult {
  query: string;
  matches: EntityRecord[];
  total: number;
}

function collectNamesFromCase(c: StoredCase): string[] {
  const names: string[] = [];
  if (c.plaintiff) names.push(c.plaintiff);
  if (c.defendant) names.push(c.defendant);
  if (c.parties) names.push(...extractEntityCandidates(c.parties));
  for (const p of c.participants) {
    if (p.name) names.push(p.name);
  }
  return names;
}

function looksLikeOrg(name: string): boolean {
  return /ооо|ао|пао|зао|ип|гуп|муп|фгуп|нко|банк|страх|фонд|министер|управлен|комитет|администрац/i.test(name);
}

/** Build entity index from catalog (in-memory, rebuilt on each call). */
export function buildEntityIndex(catalog: CaseCatalog): Map<string, EntityRecord> {
  const index = new Map<string, EntityRecord>();

  catalog.forEach((c) => {
    const seen = new Set<string>();
    for (const raw of collectNamesFromCase(c)) {
      if (!looksLikeOrg(raw)) continue;
      const norm = normalizeEntityName(raw);
      if (!norm || seen.has(norm.key)) continue;
      seen.add(norm.key);

      let rec = index.get(norm.key);
      if (!rec) {
        rec = {
          key: norm.key,
          canonical: norm.canonical,
          opf: norm.opf,
          aliases: [],
          caseIds: [],
          caseCount: 0,
          regions: [],
          courts: [],
        };
        index.set(norm.key, rec);
      }

      if (!rec.aliases.includes(norm.raw)) rec.aliases.push(norm.raw);
      if (!rec.caseIds.includes(c.id)) {
        rec.caseIds.push(c.id);
        rec.caseCount++;
      }
      const region = c.courtRegion ?? "—";
      if (!rec.regions.includes(region)) rec.regions.push(region);
      if (!rec.courts.includes(c.courtSubdomain)) rec.courts.push(c.courtSubdomain);
    }
  });

  return index;
}

export function resolveEntity(catalog: CaseCatalog, query: string, limit = 20): EntityResolveResult {
  const q = query.trim();
  const index = buildEntityIndex(catalog);
  const qLower = q.toLowerCase();
  const qNorm = normalizeEntityName(q);

  const scored: Array<{ rec: EntityRecord; score: number }> = [];

  for (const rec of index.values()) {
    let score = 0;
    if (rec.key === qNorm?.key) score += 100;
    if (rec.canonical.toLowerCase().includes(qLower)) score += 50;
    if (rec.key.includes(qLower) || qLower.includes(rec.key)) score += 30;
    for (const a of rec.aliases) {
      if (a.toLowerCase().includes(qLower)) score += 20;
    }
    if (score > 0) scored.push({ rec, score });
  }

  scored.sort((a, b) => b.score - a.score || b.rec.caseCount - a.rec.caseCount);

  const matches = scored.slice(0, limit).map((s) => ({
    ...s.rec,
    aliases: s.rec.aliases.slice(0, 12),
    caseIds: s.rec.caseIds.slice(0, 50),
  }));

  return { query: q, matches, total: scored.length };
}

export function entityIndexStats(catalog: CaseCatalog): { entities: number; withMultipleAliases: number } {
  const index = buildEntityIndex(catalog);
  let withMultipleAliases = 0;
  for (const rec of index.values()) {
    if (rec.aliases.length > 1) withMultipleAliases++;
  }
  return { entities: index.size, withMultipleAliases };
}
