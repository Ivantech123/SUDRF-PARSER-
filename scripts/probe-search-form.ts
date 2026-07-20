/**
 * Compare delo_id categories on a Mordovia court: which ones return 2-* vs 11-*.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { SudrfClient, CASE_CATEGORIES } from "../src/sudrf/index.js";

const court = process.env.PROBE_COURT || "leninsky--mor";
const outDir = "data/probes";
mkdirSync(outDir, { recursive: true });

const client = new SudrfClient();

try {
  for (const cat of CASE_CATEGORIES) {
    process.stdout.write(`delo=${cat.deloId} ${cat.label.slice(0, 42).padEnd(42)} … `);
    try {
      const r = await client.searchCases(
        court,
        cat.deloId,
        { resultDateFrom: "01.01.2026", resultDateTo: "18.07.2026" },
        { maxPages: 1 },
      );
      const prefs: Record<string, number> = {};
      for (const row of r.results) {
        const p = row.caseNumber?.split("-")[0] ?? "?";
        prefs[p] = (prefs[p] ?? 0) + 1;
      }
      console.log(`rows=${r.results.length} total=${r.total}`, JSON.stringify(prefs));
      if (r.results[0]) {
        console.log(
          `   e.g. ${r.results[0].caseNumber} | ${(r.results[0].status ?? "").slice(0, 50)}`,
        );
      }
      writeFileSync(
        `${outDir}/${court}-delo${cat.deloId}.json`,
        JSON.stringify(
          {
            deloId: cat.deloId,
            label: cat.label,
            total: r.total,
            prefixes: prefs,
            sample: r.results.slice(0, 10).map((x) => ({
              caseNumber: x.caseNumber,
              status: x.status,
              category: x.category?.slice(0, 80),
            })),
          },
          null,
          2,
        ),
        "utf8",
      );
    } catch (e) {
      console.log(`FAIL ${e instanceof Error ? e.message : e}`);
    }
  }
} finally {
  await client.close();
}
