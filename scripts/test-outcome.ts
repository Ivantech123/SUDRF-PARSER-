import { classifyOutcome, summarizeOutcomes } from "../src/analytics/outcome.js";

const samples: Array<[string, string]> = [
  ["Иск удовлетворен", "granted"],
  ["Исковые требования удовлетворены частично", "granted_partial"],
  ["В иске отказано", "denied"],
  ["Утверждено мировое соглашение", "settled"],
  ["Производство по делу прекращено", "terminated"],
  ["Решение оставить без изменения", "appealed_upheld"],
];

let failed = 0;
for (const [status, expect] of samples) {
  const v = classifyOutcome({ status });
  const ok = v.label === expect;
  console.log(`${ok ? "OK" : "FAIL"} status=${JSON.stringify(status)} → ${v.label}`);
  if (!ok) failed++;
}

const doc = "… РЕШИЛ: исковые требования Иванова удовлетворить. Взыскать …";
const fromDoc = classifyOutcome({ documentText: doc });
console.log(`doc → ${fromDoc.label} (${fromDoc.evidence})`);
if (fromDoc.label !== "granted") failed++;

const sum = summarizeOutcomes([
  classifyOutcome({ status: "В иске отказано" }),
  classifyOutcome({ status: "Иск удовлетворен" }),
  classifyOutcome({ status: "непонятно" }),
]);
console.log("summary", sum);
if (sum.known !== 2) failed++;

if (failed) {
  console.error(`FAILED: ${failed}`);
  process.exit(1);
}
console.log("ALL OK");
