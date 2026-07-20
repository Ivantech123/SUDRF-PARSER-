/** Pull hearing schedules — often list first-instance 2-* civil cases. */
import { SudrfClient } from "../src/sudrf/index.js";

const court = process.env.PROBE_COURT || "leninsky--mor";
const client = new SudrfClient();

function ddmm(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

try {
  const prefs: Record<string, number> = {};
  let total = 0;
  const samples: string[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const date = ddmm(d);
    const sch = await client.getHearingSchedule(court, date);
    for (const item of sch.items) {
      total++;
      const p = (item.caseNumber || "?").split("-")[0]!;
      prefs[p] = (prefs[p] || 0) + 1;
      if (samples.length < 15) {
        samples.push(`${date} ${item.caseNumber} | ${item.category.slice(0, 50)}`);
      }
    }
    if (sch.items.length) console.log(date, sch.items.length, sch.parseStatus);
  }
  console.log("total items", total, "prefixes", prefs);
  for (const s of samples) console.log(" ", s);
} finally {
  await client.close();
}
