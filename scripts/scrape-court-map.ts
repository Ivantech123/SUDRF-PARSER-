// Scrape the canonical list of sudrf.ru court subdomains from the portal's
// own court-map page. sudrf.ru exposes a directory of courts with links to
// <subdomain>.sudrf.ru — this is the authoritative source, not guesswork.
// Run: npx tsx scripts/scrape-court-map.ts
import { fetchSudrf } from "../src/sudrf/http.js";
import * as cheerio from "cheerio";

// The portal's court selection entry points. Try several; keep the first that
// yields subdomain links.
const ENTRY = [
  "https://sudrf.ru/",
  "https://www.sudrf.ru/",
];

interface Found { subdomain: string; name: string; url: string; }

async function tryUrl(rawUrl: string): Promise<Found[]> {
  const u = new URL(rawUrl);
  const sub = u.hostname.split(".")[0];
  const path = u.pathname + u.search;
  const res = await fetchSudrf({ subdomain: sub === "www" ? "sudrf" : sub, path: path || "/", timeoutMs: 20000 });
  const $ = cheerio.load(res.html);
  const found: Found[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    // match https://<sub>.sudrf.ru...  (sub may contain letters, digits, dashes)
    const m = href.match(/^https?:\/\/([a-z0-9-]+)\.sudrf\.ru/i);
    if (!m) return;
    const subdomain = m[1].toLowerCase();
    if (subdomain === "sudrf" || subdomain === "www") return;
    if (seen.has(subdomain)) return;
    seen.add(subdomain);
    const name = $(a).text().replace(/\s+/g, " ").trim();
    found.push({ subdomain, name, url: href });
  });
  return found;
}

let all: Found[] = [];
for (const url of ENTRY) {
  try {
    const got = await tryUrl(url);
    console.log(`${url} -> ${got.length} courts`);
    if (got.length) { all = got; break; }
  } catch (e) {
    console.log(`${url} -> ERR ${(e as Error).message.slice(0, 80)}`);
  }
}

if (!all.length) {
  console.log("No court links found on the entry pages.");
  process.exit(0);
}

console.log("\nSample (first 30):");
for (const c of all.slice(0, 30)) console.log(`  ${c.subdomain.padEnd(28)} ${c.name.slice(0, 60)}`);
console.log(`\nTotal: ${all.length}`);
// dump full list as JSON for inspection
console.log("\n=== JSON ===");
console.log(JSON.stringify(all, null, 2));
