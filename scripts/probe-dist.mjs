import { SudrfClient } from "../dist/sudrf/index.js";
const client = new SudrfClient();
try {
  const s = await client.getHearingSchedule("vs--mor", "30.06.2026");
  console.log("count=", s.count, "first=", s.items[0]?.caseNumber);
} catch(e){ console.log("ERR", e.message); }
await client.close();
