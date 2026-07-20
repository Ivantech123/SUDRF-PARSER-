import { fetchSudrf } from "../src/sudrf/http.js";
const res = await fetchSudrf({ subdomain: "vs--mor", path: "/modules.php?name=sud_delo&srv_num=1&H_date=30.06.2026" });
// strip to first interesting table
const m = res.html.match(/<table[^>]*>[\s\S]*?<\/table>/gi);
if (m) {
  // find the table that contains "Пужаев" (a judge name) = the schedule
  const tbl = m.find(t => /Пужаев|Зал|судья/i.test(t)) || m[0];
  console.log(tbl.slice(0, 4000));
}
