// Dump the sudrf.ru homepage to see how courts are listed (JS widget? search form?).
import { fetchSudrf } from "../src/sudrf/http.js";
const res = await fetchSudrf({ subdomain: "sudrf", path: "/", timeoutMs: 20000 });
console.log("status", res.status, "len", res.html.length);
// print every <a href> and every <select>/<option>, plus any inline JSON-ish blobs
import * as cheerio from "cheerio";
const $ = cheerio.load(res.html);
console.log("\n-- links (first 40) --");
$("a[href]").slice(0, 40).each((_, a) => {
  console.log("  ", $(a).attr("href"), "|", $(a).text().replace(/\s+/g, " ").trim().slice(0, 50));
});
console.log("\n-- selects --");
$("select").each((_, s) => {
  const name = $(s).attr("name") || $(s).attr("id") || "?";
  console.log("  select", name, "options:", $(s).find("option").length);
  $(s).find("option").slice(0, 8).each((_, o) => {
    console.log("    ", $(o).attr("value"), "|", $(o).text().replace(/\s+/g, " ").trim().slice(0, 50));
  });
});
console.log("\n-- forms --");
$("form").each((_, f) => {
  console.log("  form action=", $(f).attr("action"), "name=", $(f).attr("name"));
});
// any data-* or script with subdomain-like strings
const m = res.html.match(/[a-z0-9-]+\.sudrf\.ru/gi);
if (m) console.log("\n-- inline subdomain refs --", [...new Set(m.map(s=>s.toLowerCase()))].slice(0, 30).join(", "));
