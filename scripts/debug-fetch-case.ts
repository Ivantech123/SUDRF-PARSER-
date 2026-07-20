import { fetchSudrf } from "../src/sudrf/http.js";
import { writeFileSync } from "node:fs";

const path = "/modules.php?name=sud_delo&case_id=155820227";
const res = await fetchSudrf({ subdomain: "oktyabrsky--mor", path, preferHttp: true });
console.log("status:", res.status, "url:", res.url, "len:", res.html.length);
console.log("has cont1:", res.html.includes('id="cont1"'));
console.log("has cont_doc:", /cont_doc\d/.test(res.html));
console.log("antibot:", /qrator|qaptcha/i.test(res.html));
console.log("head:", res.html.slice(0, 500).replace(/\s+/g, " "));
writeFileSync("scripts/live_case_sample.html", res.html, "utf8");
console.log("saved scripts/live_case_sample.html");
