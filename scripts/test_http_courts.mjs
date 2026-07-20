#!/usr/bin/env node
/** Quick on-VPS test for HTTP/SSL court fetch fix. */
import { fetchSudrf } from "../dist/sudrf/http.js";

const courts = [
  "krasnogvardeysky--adg",
  "maikopsky--adg",
  "bizhbuliaksky--bkr",
  "abzelilovsky--bkr",
  "oktyabrsky--mor",
];
const date = "09.07.2026";

for (const sub of courts) {
  try {
    const r = await fetchSudrf({
      subdomain: sub,
      path: `/modules.php?name=sud_delo&srv_num=1&H_date=${encodeURIComponent(date)}`,
      preferHttp: true,
    });
    const ok = r.status === 200 && r.html.length > 500;
    console.log(`${sub}: status=${r.status} proto=${r.url.startsWith("http:") ? "http" : "https"} len=${r.html.length} ok=${ok}`);
  } catch (e) {
    console.log(`${sub}: ERROR ${e instanceof Error ? e.message : e}`);
  }
}
