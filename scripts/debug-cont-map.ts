import { readFileSync } from "node:fs";
import * as cheerio from "cheerio";
import { parseCaseDetails } from "../src/sudrf/case-parser.js";

const html = readFileSync("./scripts/case_acts_sample.html", "utf8");
const $ = cheerio.load(html);
for (let i = 1; i <= 5; i++) {
  const c = $(`#cont${i}`);
  const th = c.find("th").first().text().replace(/\s+/g, " ").trim().slice(0, 70);
  console.log(`cont${i} th=${th}`);
}
const p = parseCaseDetails(html, "vs--mor");
console.log("sample participants", p.participants.length, "category", (p.category || "").slice(0, 60));
