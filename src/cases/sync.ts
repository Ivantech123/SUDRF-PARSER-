import type { CaseDetails } from "../sudrf/types.js";
import type { StoredCase } from "./store.js";

export interface CaseChange {
  at: string;
  field: string;
  from?: string;
  to?: string;
}

function snap(c: StoredCase): Record<string, string | number | undefined> {
  return {
    status: c.status,
    judge: c.judge,
    category: c.category,
    documentsCount: c.documentsCount,
    eventsCount: c.events?.length ?? 0,
    participantsCount: c.participants?.length ?? 0,
  };
}

function snapDetails(d: CaseDetails): Record<string, string | number | undefined> {
  return {
    status: d.status,
    judge: d.judge,
    category: d.category,
    documentsCount: d.documents?.length ?? 0,
    eventsCount: d.events?.length ?? 0,
    participantsCount: d.participants?.length ?? 0,
  };
}

/** Compare catalog row with fresh sudrf card; return human-readable deltas. */
export function diffCase(existing: StoredCase, details: CaseDetails): CaseChange[] {
  const now = new Date().toISOString();
  const before = snap(existing);
  const after = snapDetails(details);
  const changes: CaseChange[] = [];

  for (const field of Object.keys(after)) {
    const from = before[field]?.toString();
    const to = after[field]?.toString();
    if (from !== to) {
      changes.push({ at: now, field, from, to });
    }
  }

  const prevDocIds = new Set((existing.documents ?? []).map((d) => d.docId));
  for (const doc of details.documents ?? []) {
    if (!prevDocIds.has(doc.docId)) {
      changes.push({
        at: now,
        field: "document_added",
        to: doc.name,
      });
    }
  }

  return changes;
}

export function mergeChangeLog(existing: CaseChange[] | undefined, incoming: CaseChange[], max = 30): CaseChange[] {
  return [...(existing ?? []), ...incoming].slice(-max);
}
