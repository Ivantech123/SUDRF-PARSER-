// Full Tier-2 end-to-end: Playwright opens the civil-case search form,
// extracts the captcha, solves it with ddddocr, submits, and parses results.
import { SudrfClient } from "../src/sudrf/index.js";

const client = new SudrfClient({ headless: true });
try {
  // Broad filter: civil cases entered in a recent month → expect results.
  const res = await client.searchCases("vs--mor", 5, {
    entryDateFrom: "01.06.2026",
    entryDateTo: "30.06.2026",
  });
  console.log("court:", res.court);
  console.log("category:", res.category);
  console.log("total:", res.total);
  console.log(JSON.stringify(res.results.slice(0, 3), null, 2));
} catch (e: any) {
  console.log("ERR:", e.message);
} finally {
  await client.close();
}
