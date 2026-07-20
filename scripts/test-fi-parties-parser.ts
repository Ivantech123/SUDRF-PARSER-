import { readFileSync } from "node:fs";
import { parseCaseDetails } from "../src/sudrf/case-parser.js";

// Old appeal sample must still work
import { parseCaseDetails as parse } from "../src/sudrf/case-parser.js";

const fi = parseCaseDetails(
  readFileSync("./scripts/case_fi_parties_sample.html", "utf8"),
  "Ленинский районный суд",
);
console.log("=== FI (shifted conts) ===");
console.log(
  JSON.stringify(
    {
      caseNumber: fi.caseNumber,
      category: fi.category,
      plaintiff: fi.plaintiff,
      defendant: fi.defendant,
      events: fi.events.length,
      participants: fi.participants.map((p) => `${p.role}: ${p.name}`),
    },
    null,
    2,
  ),
);

const ok =
  fi.participants.length === 9
  && /Екохина/i.test(fi.participants[0]?.name ?? "")
  && /истреб|собствен/i.test(fi.category)
  && /Огарёва|Огарева|МГУ/i.test(fi.plaintiff ?? "")
  && fi.events.length === 2;

const appeal = parse(
  readFileSync("./scripts/case_acts_sample.html", "utf8"),
  "ВС РМ",
);
console.log("=== Appeal (legacy cont4) ===");
console.log({
  caseNumber: appeal.caseNumber,
  participants: appeal.participants.length,
  events: appeal.events.length,
  category: (appeal.category || "").slice(0, 60),
});

if (!ok) {
  console.error("FI PARSE FAILED");
  process.exit(1);
}
if (appeal.participants.length < 1 || appeal.events.length < 1) {
  console.error("APPEAL REGRESSION");
  process.exit(1);
}
console.log("OK");
