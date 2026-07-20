import { CaseCatalog } from "../src/cases/store.js";
import { SudrfClient } from "../src/sudrf/index.js";
import { parseCaseDetails } from "../src/sudrf/case-parser.js";
import * as cheerio from "cheerio";
import { writeFileSync } from "node:fs";

const catalog = new CaseCatalog();
catalog.load("./cases-store.json");
let target: { caseUrl: string; courtSubdomain: string; caseNumber: string } | null = null;
catalog.forEach((c) => {
  if (target) return;
  if (c.courtSubdomain === "oktyabrsky--mor" && c.caseUrl && /^2-/.test(c.caseNumber)) {
    target = { caseUrl: c.caseUrl, courtSubdomain: c.courtSubdomain, caseNumber: c.caseNumber };
  }
});
if (!target) throw new Error("no target");
console.log("target", target.caseNumber, target.caseUrl);

const client = new SudrfClient({ headless: true });
try {
  const details = await client.getCaseDetails(target.courtSubdomain, target.caseUrl);
  console.log("parsed", {
    category: details.category,
    parts: details.participants?.length,
    events: details.events?.length,
    sample: details.participants?.slice(0, 3),
  });

  // raw html via internal path
  const { fetchSudrf } = await import("../src/sudrf/http.js");
  const court = (await import("../src/sudrf/courts.js")).COURT_REGISTRY.find((c) => c.subdomain === target!.courtSubdomain)!;
  let path = target.caseUrl;
  if (path.startsWith("http")) {
    const u = new URL(path);
    path = u.pathname + u.search;
  }
  const res = await fetchSudrf({ subdomain: court.subdomain, path, preferHttp: court.http });
  writeFileSync("./data/debug-case.html", res.html, "utf8");
  const $ = cheerio.load(res.html);
  console.log("status", res.status, "bodyLen", res.html.length);
  console.log("antibot?", /captcha|селениум|доступ ограничен|cloudflare/i.test(res.html));
  console.log("has cont1", $("#cont1").length, "has tablcont", $("#tablcont").length);
  console.log("snippet", res.html.replace(/\s+/g, " ").slice(0, 400));
  for (let i = 1; i <= 5; i++) {
    const $c = $(`#cont${i}`);
    if (!$c.length) {
      console.log(`cont${i}: MISSING`);
      continue;
    }
    const th = $c.find("th").first().text().replace(/\s+/g, " ").trim().slice(0, 80);
    const tabs = $(`li#tab${i}`).text().replace(/\s+/g, " ").trim();
    console.log(`cont${i}: tab=${tabs} th=${th} tables=${$c.find("table").length}`);
    const hasVid = $c.text().toLowerCase().includes("вид лица");
    const hasKat = $c.text().toLowerCase().includes("категор");
    console.log(`  hasVidLica=${hasVid} hasKategor=${hasKat}`);
  }
  const tabs = $("ul.tabs li").map((_, li) => $(li).text().replace(/\s+/g, " ").trim()).get();
  console.log("tabs:", tabs);
} finally {
  await client.close().catch(() => {});
}
