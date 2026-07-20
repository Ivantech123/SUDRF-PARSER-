import { SudrfClient } from "../src/sudrf/index.js";
import type { SearchFilters } from "../src/sudrf/categories.js";

const client = new SudrfClient();
const tests: Array<{ label: string; delo: number; f: SearchFilters; pages?: number }> = [
  { label: "delo5 wide result", delo: 5, f: { resultDateFrom: "18.07.2024", resultDateTo: "18.07.2026" } },
  { label: "delo5 entry 2025", delo: 5, f: { entryDateFrom: "01.01.2025", entryDateTo: "18.07.2026" } },
  { label: "delo5 no dates", delo: 5, f: {} },
  { label: "delo2800001 wide", delo: 2800001, f: { resultDateFrom: "01.01.2024", resultDateTo: "18.07.2026" } },
  { label: "delo41 appeal", delo: 41, f: { resultDateFrom: "01.01.2025", resultDateTo: "18.07.2026" } },
];

try {
  for (const t of tests) {
    process.stdout.write(`${t.label} … `);
    const r = await client.searchCases("leninsky--mor", t.delo, t.f, { maxPages: t.pages ?? 1 });
    const prefs: Record<string, number> = {};
    for (const row of r.results) {
      const p = (row.caseNumber || "?").split("-")[0]!;
      prefs[p] = (prefs[p] || 0) + 1;
    }
    console.log(`rows=${r.results.length} total=${r.total}`, JSON.stringify(prefs));
    if (r.results[0]) {
      console.log(`  e.g. ${r.results[0].caseNumber} | ${(r.results[0].status ?? "").slice(0, 50)}`);
    }
  }
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await client.close();
}
