import { SudrfClient } from "../src/sudrf/index.js";

const court = process.env.PROBE_COURT || "leninsky--mor";
const delo = Number(process.env.PROBE_DELO || 5);
const caseNumber = process.env.PROBE_CASE || "2-";

const client = new SudrfClient();
try {
  console.log(`probe ${court} delo=${delo} caseNumber=${caseNumber}`);
  const r = await client.searchCases(
    court,
    delo,
    {
      caseNumber,
      resultDateFrom: "01.01.2025",
      resultDateTo: "18.07.2026",
    },
    { maxPages: 3 },
  );
  console.log(`total=${r.total} rows=${r.results.length}`);
  for (const x of r.results.slice(0, 12)) {
    console.log(`  ${x.caseNumber}\t${(x.status ?? "").slice(0, 50)}`);
  }
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await client.close();
}
