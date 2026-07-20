// Inspect all cont1..cont4 blocks of the case-with-acts sample.
import { readFileSync } from "node:fs";
import * as cheerio from "cheerio";

const html = readFileSync(new URL("./case_acts_sample.html", import.meta.url), "utf8");
const $ = cheerio.load(html);

for (const id of ["cont1", "cont2", "cont3", "cont4"]) {
  const $el = $(`#${id}`).first();
  console.log(`\n===== ${id} (len ${$el.length}) =====`);
  // tables and their rows
  $el.find("table").slice(0, 2).each((ti, t) => {
    console.log(`-- table ${ti} --`);
    $(t).find("tr").slice(0, 8).each((_, tr) => {
      const cells = $(tr).find("td,th").map((_, c) => $(c).text().replace(/\s+/g, " ").trim()).get();
      console.log("  ", JSON.stringify(cells));
    });
  });
  // label/value pairs as plain text (first 500 chars)
  const txt = $el.text().replace(/\s+/g, " ").trim();
  console.log("text:", txt.slice(0, 500));
}
