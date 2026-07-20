// Inspect cont_doc1 block of a case that has published judicial acts.
import { readFileSync } from "node:fs";
import * as cheerio from "cheerio";

const html = readFileSync(new URL("./case_acts_sample.html", import.meta.url), "utf8");
const $ = cheerio.load(html);

const $doc = $("#cont_doc1").first();
console.log("cont_doc1 length:", $doc.length);
console.log("--- text ---");
console.log($doc.text().replace(/\s+/g, " ").trim().slice(0, 800));
console.log("\n--- links (href + anchor text) ---");
$doc.find("a").each((_, a) => {
  const href = $(a).attr("href") ?? "";
  const text = $(a).text().replace(/\s+/g, " ").trim();
  if (href || text) console.log(`  [${text.slice(0, 60)}] -> ${href.slice(0, 120)}`);
});
console.log("\n--- onclick handlers ---");
$doc.find("[onclick]").each((_, el) => {
  const oc = $(el).attr("onclick") ?? "";
  console.log("  onclick:", oc.slice(0, 140));
});
console.log("\n--- table rows in cont_doc1 ---");
$doc.find("table tr").slice(0, 6).each((_, tr) => {
  const cells = $(tr).find("td,th").map((_, c) => $(c).text().replace(/\s+/g, " ").trim()).get();
  console.log("  row:", JSON.stringify(cells));
});
