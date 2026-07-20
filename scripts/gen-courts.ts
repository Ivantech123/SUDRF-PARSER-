// Generate src/sudrf/courts.ts from the canonical sudrfscraper registry
// (config_sudrf.json). The upstream repo maintains the authoritative
// vnkod→URL→name mapping for all ~2270 sudrf.ru courts; we derive our typed
// registry from it instead of guessing subdomain codes.
//
// Run:  npx tsx scripts/gen-courts.ts <path-to-config_sudrf.json>
//   (default path: /tmp/sudrfscraper/src/main/resources/config/config_sudrf.json)
import { readFileSync, writeFileSync } from "node:fs";

const input = process.argv[2] ?? "/tmp/sudrfscraper/src/main/resources/config/config_sudrf.json";

interface UpstreamCourt {
  id: number;
  region: number;
  searchString: string;
  level: string;        // DISTRICT | REGION | CASSATION | GARRISON | MOSGORSUD
  vnkod: string;
  name: string;
  connection: string;   // REQUEST (HTTP) | SELENIUM (browser)
  hasCaptcha: boolean;
}

const raw = JSON.parse(readFileSync(input, "utf8")) as UpstreamCourt[];

// Extract subdomain from searchString: http://giaginsky--adg.sudrf.ru → giaginsky--adg
function subdomainOf(url: string): string | null {
  const m = url.match(/^https?:\/\/([a-z0-9-]+)\.sudrf\.ru/i);
  return m ? m[1].toLowerCase() : null;
}

// Map upstream level → our CourtType
function typeOf(level: string): string {
  switch (level) {
    case "REGION": return "oblsud";     // областной/краевой/республиканский ВС
    case "CASSATION": return "vs";       // кассационные / ВС уровня
    case "GARRISON": return "garb";      // военный
    case "MOSGORSUD": return "oblsud";
    case "DISTRICT":
    default: return "ray";
  }
}

// Region code → subject name (best-effort; region is a numeric code in upstream).
// We keep the numeric region code as-is when no friendly name is known; the
// registry is searched by subdomain/name, not region string.
const seen = new Set<string>();
const entries: { subdomain: string; name: string; region: string; type: string; vnkod: string; captcha: boolean; http: boolean }[] = [];
let skipped = 0;
for (const c of raw) {
  const sub = subdomainOf(c.searchString);
  if (!sub) { skipped++; continue; }
  if (seen.has(sub)) { skipped++; continue; } // dedup by subdomain
  seen.add(sub);
  entries.push({
    subdomain: sub,
    name: c.name,
    region: String(c.region),
    type: typeOf(c.level),
    vnkod: c.vnkod,
    captcha: c.hasCaptcha,
    http: c.connection === "REQUEST",
  });
}

// sort: by region code then name for stable output
entries.sort((a, b) => (a.region.padStart(3, "0") + a.name).localeCompare(b.region.padStart(3, "0") + b.name));

const lines: string[] = [];
lines.push(`// Auto-generated from the canonical sudrfscraper registry.`);
lines.push(`// Source: github.com/tochno-st/sudrfscraper  config_sudrf.json`);
lines.push(`// ${entries.length} courts across 86 regions. Regenerate via scripts/gen-courts.ts.`);
lines.push(`// Do not edit by hand — edit the generator and re-run.`);
lines.push(``);
lines.push(`export interface CourtEntry {`);
lines.push(`  subdomain: string;        // e.g. "giaginsky--adg" → https://giaginsky--adg.sudrf.ru`);
lines.push(`  name: string;             // наименование суда`);
lines.push(`  region: string;           // код субъекта РФ (число в upstream)`);
lines.push(`  type: CourtType;`);
lines.push(`  vnkod: string;            // код суда в ГАС Правосудия`);
lines.push(`  captcha: boolean;         // требуется ли решать капчу при поиске`);
lines.push(`  http: boolean;            // REQUEST = plain HTTP (Tier 1); false = SELENIUM (Tier 2 browser)`);
lines.push(`}`);
lines.push(``);
lines.push(`export type CourtType =`);
lines.push(`  | "vs"    // Верховный суд республики / края / области / кассационный`);
lines.push(`  | "oblsud"// Областной / краевой / республиканский суд`);
lines.push(`  | "ray"   // Районный / городской суд`);
lines.push(`  | "garb"  // Военный (гарнизонный) суд`);
lines.push(`  | "other";`);
lines.push(``);
lines.push(`export const COURT_REGISTRY: CourtEntry[] = [`);
for (const e of entries) {
  const name = e.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  lines.push(`  { subdomain: "${e.subdomain}", name: "${name}", region: "${e.region}", type: "${e.type}", vnkod: "${e.vnkod}", captcha: ${e.captcha}, http: ${e.http} },`);
}
lines.push(`];`);
lines.push(``);
lines.push(`export function findCourt(query: string): CourtEntry | null {`);
lines.push(`  const q = query.trim().toLowerCase();`);
lines.push(`  if (!q) return null;`);
lines.push(`  // exact subdomain match first`);
lines.push(`  const bySub = COURT_REGISTRY.find(c => c.subdomain === q);`);
lines.push(`  if (bySub) return bySub;`);
lines.push(`  // vnkod match (e.g. "01RS0001")`);
lines.push(`  const byVnkod = COURT_REGISTRY.find(c => c.vnkod.toLowerCase() === q);`);
lines.push(`  if (byVnkod) return byVnkod;`);
lines.push(`  // substring match on name. When the query looks like a region/subject`);
lines.push(`  // (short, no "суд" word), prefer the highest-level court (oblsud/vs) so`);
lines.push(`  // "Мордовия" → Верховный Суд Мордовии, not the first district court.`);
lines.push(`  const matches = COURT_REGISTRY.filter(c => c.name.toLowerCase().includes(q));`);
lines.push(`  if (!matches.length) return null;`);
lines.push(`  const rank: Record<string, number> = { oblsud: 0, vs: 1, ray: 2, garb: 3, other: 4 };`);
lines.push(`  const isRegionQuery = !/суд|район|город|межрайон|участок|гарнизон/i.test(q);`);
lines.push(`  if (isRegionQuery) {`);
lines.push(`    matches.sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9));`);
lines.push(`    return matches[0];`);
lines.push(`  }`);
lines.push(`  return matches[0];`);
lines.push(`}`);
lines.push(``);
lines.push(`export function courtBaseUrl(subdomain: string): string {`);
lines.push(`  return \`https://\${subdomain}.sudrf.ru\`;`);
lines.push(`}`);
lines.push(``);

const out = lines.join("\n");
writeFileSync(new URL("../src/sudrf/courts.ts", import.meta.url), out);
console.log(`Wrote ${entries.length} courts to src/sudrf/courts.ts (skipped ${skipped} dupes/invalid).`);
console.log(`By type:`, entries.reduce((m, e) => (m[e.type] = (m[e.type] ?? 0) + 1, m), {} as Record<string, number>));
console.log(`By captcha:`, entries.reduce((m, e) => (m[String(e.captcha)] = (m[String(e.captcha)] ?? 0) + 1, m), {} as Record<string, number>));
console.log(`By http:`, entries.reduce((m, e) => (m[String(e.http)] = (m[String(e.http)] ?? 0) + 1, m), {} as Record<string, number>));
