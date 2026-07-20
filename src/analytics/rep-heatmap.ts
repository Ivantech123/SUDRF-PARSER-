// Heatmaps for representatives / advocates / jurists across Mordovia courts.

import type { CaseCatalog, StoredCase } from "../cases/store.js";
import { isDepersonalizedMarker } from "./person-name.js";

function personKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export type RepSubtype = "representative" | "advocate" | "jurist";

export const REP_SUBTYPE_LABELS: Record<RepSubtype, string> = {
  representative: "Представитель",
  advocate: "Адвокат",
  jurist: "Юрист",
};

/** Narrow role on the card → subtype (priority: адвокат → юрист → представитель). */
export function classifyRepSubtype(role: string): RepSubtype | null {
  const r = role.toLowerCase();
  if (!/представ|адвокат|защитник|юрист/.test(r)) return null;
  if (/адвокат|защитник/.test(r)) return "advocate";
  if (/юрист/.test(r)) return "jurist";
  if (/представ/.test(r)) return "representative";
  return null;
}

export interface RepCourtHeatCell {
  subdomain: string;
  name: string;
  appearances: number;
  uniquePeople: number;
  bySubtype: Record<
    RepSubtype,
    { appearances: number; uniquePeople: number }
  >;
  intensity: number;
}

export interface RepMatrixRow {
  id: string;
  name: string;
  total: number;
  bySubtype: Partial<Record<RepSubtype, number>>;
}

export interface RepMatrixCol {
  subdomain: string;
  shortName: string;
}

export interface RepHeatmaps {
  byCourt: RepCourtHeatCell[];
  matrix: {
    people: RepMatrixRow[];
    courts: RepMatrixCol[];
    /** people[row] × courts[col] appearance counts */
    grid: number[][];
  };
  totals: {
    appearances: number;
    uniquePeople: number;
    bySubtype: Record<RepSubtype, { appearances: number; uniquePeople: number }>;
  };
  notes: string[];
}

const SKIP_NAME = /^(не указ|неизвест|нет данных|информация скрыта|фио#?|—|-|\.{2,})$/i;

function shortCourtName(name: string, subdomain: string): string {
  const cleaned = name
    .replace(/Республики Мордовия/gi, "")
    .replace(/районный суд/gi, "райсуд")
    .replace(/городской суд/gi, "горсуд")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= 28) return cleaned || subdomain;
  return cleaned.slice(0, 26) + "…";
}

function emptySubtypeCounts(): Record<RepSubtype, { appearances: number; uniquePeople: number }> {
  return {
    representative: { appearances: 0, uniquePeople: 0 },
    advocate: { appearances: 0, uniquePeople: 0 },
    jurist: { appearances: 0, uniquePeople: 0 },
  };
}

export function buildRepHeatmaps(
  cases: StoredCase[],
  opts?: { topPeople?: number },
): RepHeatmaps {
  const topN = Math.max(5, Math.min(40, opts?.topPeople ?? 18));

  type CourtAcc = {
    subdomain: string;
    name: string;
    appearances: number;
    people: Set<string>;
    bySubtype: Record<RepSubtype, { appearances: number; people: Set<string> }>;
  };

  const byCourt = new Map<string, CourtAcc>();
  const personTotals = new Map<
    string,
    { name: string; total: number; bySubtype: Partial<Record<RepSubtype, number>>; byCourt: Map<string, number> }
  >();
  const globalPeople = new Set<string>();
  const globalBySubtype = {
    representative: { appearances: 0, people: new Set<string>() },
    advocate: { appearances: 0, people: new Set<string>() },
    jurist: { appearances: 0, people: new Set<string>() },
  };
  let appearances = 0;

  for (const c of cases) {
    let court = byCourt.get(c.courtSubdomain);
    if (!court) {
      court = {
        subdomain: c.courtSubdomain,
        name: c.courtName || c.courtSubdomain,
        appearances: 0,
        people: new Set(),
        bySubtype: {
          representative: { appearances: 0, people: new Set() },
          advocate: { appearances: 0, people: new Set() },
          jurist: { appearances: 0, people: new Set() },
        },
      };
      byCourt.set(c.courtSubdomain, court);
    }

    for (const p of c.participants ?? []) {
      const subtype = classifyRepSubtype(p.role || "");
      if (!subtype) continue;
      const name = (p.name || "").replace(/\s+/g, " ").trim();
      if (!name || isDepersonalizedMarker(name) || SKIP_NAME.test(name)) continue;
      const id = `p:${personKey(name)}`;

      appearances++;
      globalPeople.add(id);
      globalBySubtype[subtype].appearances++;
      globalBySubtype[subtype].people.add(id);

      court.appearances++;
      court.people.add(id);
      court.bySubtype[subtype].appearances++;
      court.bySubtype[subtype].people.add(id);

      let person = personTotals.get(id);
      if (!person) {
        person = { name, total: 0, bySubtype: {}, byCourt: new Map() };
        personTotals.set(id, person);
      }
      person.total++;
      person.bySubtype[subtype] = (person.bySubtype[subtype] ?? 0) + 1;
      person.byCourt.set(c.courtSubdomain, (person.byCourt.get(c.courtSubdomain) ?? 0) + 1);
    }
  }

  const maxApp = Math.max(1, ...[...byCourt.values()].map((x) => x.appearances));
  const courtCells: RepCourtHeatCell[] = [...byCourt.values()]
    .map((x) => ({
      subdomain: x.subdomain,
      name: x.name,
      appearances: x.appearances,
      uniquePeople: x.people.size,
      bySubtype: {
        representative: {
          appearances: x.bySubtype.representative.appearances,
          uniquePeople: x.bySubtype.representative.people.size,
        },
        advocate: {
          appearances: x.bySubtype.advocate.appearances,
          uniquePeople: x.bySubtype.advocate.people.size,
        },
        jurist: {
          appearances: x.bySubtype.jurist.appearances,
          uniquePeople: x.bySubtype.jurist.people.size,
        },
      },
      intensity: x.appearances / maxApp,
    }))
    .sort((a, b) => b.appearances - a.appearances || b.uniquePeople - a.uniquePeople);

  const topPeople = [...personTotals.entries()]
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => b.total - a.total)
    .slice(0, topN);

  // Courts that appear in the matrix: prefer those with any top-person activity, else all with reps
  const courtOrder = courtCells
    .filter((c) => c.appearances > 0)
    .map((c) => ({
      subdomain: c.subdomain,
      shortName: shortCourtName(c.name, c.subdomain),
    }));

  const grid = topPeople.map((person) =>
    courtOrder.map((col) => person.byCourt.get(col.subdomain) ?? 0),
  );

  return {
    byCourt: courtCells,
    matrix: {
      people: topPeople.map((p) => ({
        id: p.id,
        name: p.name,
        total: p.total,
        bySubtype: p.bySubtype,
      })),
      courts: courtOrder,
      grid,
    },
    totals: {
      appearances,
      uniquePeople: globalPeople.size,
      bySubtype: {
        representative: {
          appearances: globalBySubtype.representative.appearances,
          uniquePeople: globalBySubtype.representative.people.size,
        },
        advocate: {
          appearances: globalBySubtype.advocate.appearances,
          uniquePeople: globalBySubtype.advocate.people.size,
        },
        jurist: {
          appearances: globalBySubtype.jurist.appearances,
          uniquePeople: globalBySubtype.jurist.people.size,
        },
      },
    },
    notes: [
      "Считаем только роли с карточки дела: представитель, адвокат/защитник, юрист/юрисконсульт.",
      "Один человек может попасть в разные слои, если в разных делах указаны разные роли.",
      "Яркость клетки — число появлений в этом суде (не уникальные ФИО).",
      "Матрица: строки — самые частые участники, столбцы — суды Мордовии.",
    ],
  };
}

/** Convenience when building from full catalog scoped to Mordovia. */
export function buildRepHeatmapsFromCatalog(
  catalog: CaseCatalog,
  opts?: { topPeople?: number },
): RepHeatmaps {
  const all: StoredCase[] = [];
  catalog.forEach((c) => {
    if (c.courtRegion && c.courtRegion !== "13") return;
    if (!c.courtRegion && !/--mor$/i.test(c.courtSubdomain)) return;
    all.push(c);
  });
  return buildRepHeatmaps(all, opts);
}
