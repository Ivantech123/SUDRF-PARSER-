// Quick live smoke test for getCaseDetails (HTTP + optional Playwright fallback).
import { SudrfClient } from "../src/sudrf/index.js";

const client = new SudrfClient();
const caseUrl = "/modules.php?name=sud_delo&case_id=155820227";

try {
  const t0 = Date.now();
  const d = await client.getCaseDetails("oktyabrsky--mor", caseUrl);
  console.log("OK", `${Date.now() - t0}ms`);
  console.log("caseNumber:", d.caseNumber);
  console.log("documents:", d.documents.length);
  console.log("events:", d.events.length);
  console.log("participants:", d.participants.length);
} catch (e) {
  console.error("FAIL:", e instanceof Error ? e.message : e);
} finally {
  await client.close();
}
