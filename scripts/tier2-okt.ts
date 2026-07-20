import { SudrfClient } from "../src/sudrf/index.js";
const client = new SudrfClient({ headless: true });
try {
  const res = await client.searchCases("oktyabrsky--mor", 5, {
    entryDateFrom: "01.06.2026",
    entryDateTo: "30.06.2026",
  });
  console.log("court:", res.court, "| category:", res.category, "| total:", res.total);
  console.log(JSON.stringify(res.results.slice(0, 3), null, 2));
} catch (e: any) { console.log("ERR:", e.message); }
await client.close();
