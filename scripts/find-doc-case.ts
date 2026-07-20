import { SudrfClient } from "../src/sudrf/index.js";
const client = new SudrfClient({ headless: true });
try {
  // search civil cases with results in early 2026 — more likely to have published acts
  const res = await client.searchCases("oktyabrsky--mor", 5, {
    entryDateFrom: "01.01.2025",
    entryDateTo: "31.12.2025",
  });
  console.log("total:", res.total);
  // pick ones with a resultDate
  const withResult = res.results.filter(r => r.resultDate);
  console.log("with resultDate:", withResult.length);
  for (const r of withResult.slice(0, 5)) {
    console.log(r.caseNumber, r.caseUrl);
  }
} catch (e: any) { console.log("ERR:", e.message); }
await client.close();
