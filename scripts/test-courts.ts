// Verify findCourt / resolveCourt on the generated registry.
import { findCourt, COURT_REGISTRY } from "../src/sudrf/courts.js";

const probes = [
  "mosgorsud",            // exact subdomain (example court) — was in old registry
  "Москва",           // region substring
  "Московский областной", // name substring
  "giaginsky--adg",     // exact subdomain (Adygeya district)
  "01RS0001",           // vnkod
  "Пермский краевой",   // name substring
];

for (const q of probes) {
  const c = findCourt(q);
  console.log(`"${q}" ->`, c ? `${c.subdomain} | ${c.name} | captcha=${c.captcha} http=${c.http}` : "NULL");
}
console.log("\nTotal registry:", COURT_REGISTRY.length);
// sanity: count http+no-captcha (fast-path eligible)
const fast = COURT_REGISTRY.filter(c => c.http && !c.captcha).length;
console.log("Fast-path eligible (http & no captcha):", fast);
