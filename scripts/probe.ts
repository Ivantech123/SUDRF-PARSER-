// Smoke test for Tier 1 (no captcha): fetch the hearing schedule for today
// from the Mordovia supreme court and print the parsed result.
import { SudrfClient } from "../src/sudrf/index.js";

const client = new SudrfClient();
try {
  const today = "04.07.2026";
  const schedule = await client.getHearingSchedule("vs--mor", today);
  console.log(JSON.stringify(schedule, null, 2));
  console.log(`\nCourt: ${schedule.court}`);
  console.log(`Date:  ${schedule.date}`);
  console.log(`Cases: ${schedule.count}`);
} finally {
  await client.close();
}
