/**
 * Fetch one Mordovia case card and dump parse result (category + participants).
 *   npx tsx scripts/fetch-and-parse-case.ts [caseUrlOrSubdomain]
 */
import { SudrfClient } from "../src/sudrf/index.js";
import { parseCaseDetails } from "../src/sudrf/case-parser.js";
import { CaseCatalog } from "../src/cases/store.js";
import * as cheerio from "cheerio";

const arg = process.argv[2];
const catalog = new CaseCatalog();
catalog.load("./cases-store.json");

let url = arg;
let sub = "leninsky--mor";
if (!url) {
  let found: { caseUrl?: string; courtSubdomain: string; caseNumber: string } | null = null;
  catalog.forEach((c) => {
    if (found) return;
    if (/2-724\/2026/i.test(c.caseNumber) && c.caseUrl) found = c;
  });
  if (!found) {
    catalog.forEach((c) => {
      if (found) return;
      if (/^2-/.test(c.caseNumber) && c.caseUrl && /leninsky/i.test(c.courtSubdomain)) found = c;
    });
  }
  if (!found) throw new Error("no case with URL in catalog");
  url = found.caseUrl!;
  sub = found.courtSubdomain;
  console.log("using", found.caseNumber, sub, url);
}

const client = new SudrfClient({ headless: true });
try {
  const html = await (client as any).fetchCaseHtml?.(sub, url)
    ?? (await import("../src/sudrf/http.js")).then(async ({ fetchSudrf }) => {
      const path = url!.startsWith("http") ? new URL(url!).pathname + new URL(url!).search : url!;
      return fetchSudrf(sub, path.startsWith("/") ? path : `/${path}`);
    });

  const $ = cheerio.load(typeof html === "string" ? html : String(html));
  const conts: Record<string, string> = {};
  for (let i = 1; i <= 6; i++) {
    const $c = $(`#cont${i}`);
    if (!$c.length) continue;
    const title = $c.find("th").first().text().replace(/\s+/g, " ").trim().slice(0, 80);
    const tabs = $(`#tab${i}`).text().replace(/\s+/g, " ").trim();
    conts[`cont${i}`] = `tab="${tabs}" th="${title}" tables=${$c.find("table").length} display=${$c.attr("style")?.includes("none") ? "none" : "show"}`;
  }
  console.log("cont map:", JSON.stringify(conts, null, 2));

  const parsed = parseCaseDetails(typeof html === "string" ? html : String(html), sub, url);
  console.log(
    JSON.stringify(
      {
        caseNumber: parsed.caseNumber,
        category: parsed.category,
        plaintiff: parsed.plaintiff,
        defendant: parsed.defendant,
        participants: parsed.participants,
        events: parsed.events?.length,
        docs: parsed.documents?.length,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close().catch(() => {});
}
