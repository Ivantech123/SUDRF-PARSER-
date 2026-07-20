import { readFileSync } from "node:fs";
import { parseSearchResults } from "../src/sudrf/parsers.js";
const html = readFileSync("scripts/okt-postsubmit.html", "utf8");
const res = parseSearchResults(html, "oktyabrsky--mor", "Гражданские");
console.log("total:", res.total, "results:", res.results.length);
console.log(JSON.stringify(res.results.slice(0, 2), null, 2));
