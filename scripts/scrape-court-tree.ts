// On a known-working court subdomain, look for a "court selection" page that
// links to OTHER court subdomains — sudrf portals usually carry a full court
// tree under modules.php?name=sud (or a region index). This is the reliable
// way to harvest the canonical subdomain list.
import { fetchSudrf } from "../src/sudrf/http.js";
import * as cheerio from "cheerio";

const ROOT = "vs--mor"; // known working
const PATHS = [
  "/modules.php?name=sud",
  "/modules.php?name=sud_delo",
  "/modules.php?name=info",
  "/modules.php?name=courts",
  "/modules.php?name=sud&op=sudlist",
  "/",
];

const seen = new Set<string>();
const courts: { subdomain: string; name: string }[] = [];

for (const path of PATHS) {
  try {
    const res = await fetchSudrf({ subdomain: ROOT, path, timeoutMs: 20000 });
    const $ = cheerio.load(res.html);
    let n = 0;
    $("a[href]").each((_, a) => {
      const href = $(a).attr("href") ?? "";
      const m = href.match(/^https?:\/\/([a-z0-9-]+)\.sudrf\.ru/i);
      if (!m) return;
      const sub = m[1].toLowerCase();
      if (sub === "sudrf" || sub === "www" || sub === ROOT || seen.has(sub)) return;
      seen.add(sub);
      const name = $(a).text().replace(/\s+/g, " ").trim();
      courts.push({ subdomain: sub, name });
      n++;
    });
    console.log(`${path} -> status ${res.status}, ${n} new subdomain links`);
  } catch (e) {
    console.log(`${path} -> ERR ${(e as Error).message.slice(0, 80)}`);
  }
}

console.log(`\nTotal distinct: ${courts.length}`);
for (const c of courts.slice(0, 60)) console.log(`  ${c.subdomain.padEnd(26)} ${c.name.slice(0, 60)}`);
if (courts.length > 60) console.log(`  ... and ${courts.length - 60} more`);
console.log("\n=== JSON ===");
console.log(JSON.stringify(courts, null, 2));
