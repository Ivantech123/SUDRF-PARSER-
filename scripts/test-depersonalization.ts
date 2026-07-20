import { classifyName, buildReport, type CaseDepersonalization } from "../src/analytics/depersonalization.js";

const cases: Array<[string, string]> = [
  ["Иванов Иван Иванович", "identifiable"],
  ["Петров И.И.", "identifiable"],
  ["И.И. Сидоров", "identifiable"],
  ["ФИО1", "depersonalized"],
  ["ФИО 2", "depersonalized"],
  ["ООО Ромашка", "org"],
  ["", "empty"],
];

let failed = 0;
for (const [raw, expect] of cases) {
  const got = classifyName(raw);
  const ok = got === expect;
  console.log(`${ok ? "OK" : "FAIL"} classify(${JSON.stringify(raw)}) → ${got} (want ${expect})`);
  if (!ok) failed++;
}

const sample: CaseDepersonalization[] = Array.from({ length: 70 }, (_, i) => ({
  caseId: `c${i}`,
  caseNumber: `2-${i}/2025`,
  courtSubdomain: "leninsky--mor",
  hasDocuments: true,
  hasActText: true,
  representativesInCard: [],
  representativesInText: [],
  representativeIdentifiable: i < 35,
  representativeOnlyDepersonalized: i >= 35 && i < 55,
  noRepresentativeFound: i >= 55,
}));
const r = buildReport(sample);
console.log("report goNoGo", r.goNoGo, "rate", r.identifiableRate);
// 55 with signal, 35 identifiable → ~64% → go
if (r.goNoGo !== "go") failed++;

if (failed) {
  console.error(`FAILED: ${failed}`);
  process.exit(1);
}
console.log("ALL OK");
