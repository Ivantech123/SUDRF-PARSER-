// Probe recent weekdays to validate the hearing-table parser on real data.
import { SudrfClient } from "../src/sudrf/index.js";

const client = new SudrfClient();
try {
  for (const d of ["30.06.2026", "01.07.2026", "02.07.2026", "03.07.2026", "26.06.2026", "25.06.2026"]) {
    try {
      const s = await client.getHearingSchedule("vs--mor", d);
      console.log(`${d}: count=${s.count}`);
      if (s.items.length) {
        console.log(JSON.stringify(s.items.slice(0, 2), null, 2));
        break;
      }
    } catch (e: any) {
      console.log(`${d}: ERR ${e.message}`);
    }
  }
} finally {
  await client.close();
}
