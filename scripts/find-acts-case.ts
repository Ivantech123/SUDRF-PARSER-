import { SudrfClient } from "../src/sudrf/index.js";
import { fetchSudrf } from "../src/sudrf/http.js";
const client = new SudrfClient({ headless: true });
try {
  // broad search across 2024 — old enough for acts to be published
  const res = await client.searchCases("oktyabrsky--mor", 5, {
    entryDateFrom: "01.01.2024",
    entryDateTo: "31.12.2024",
  });
  console.log("total:", res.total, "results on page:", res.results.length);
  let found = 0;
  for (const r of res.results) {
    if (!r.caseUrl) continue;
    const m = r.caseUrl.match(/case_id=(\d+).*case_uid=([0-9a-f-]+)/);
    if (!m) continue;
    const resp = await fetchSudrf({ subdomain: "oktyabrsky--mor", path: r.caseUrl });
    if (/cont_doc\d/.test(resp.html)) {
      console.log("FOUND acts on", r.caseNumber, r.caseUrl);
      found++;
      if (found >= 2) break;
    }
    await new Promise(f => setTimeout(f, 400));
  }
  if (!found) console.log("no cases with cont_doc in first page");
} catch (e: any) { console.log("ERR:", e.message); }
await client.close();
