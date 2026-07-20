// Verify parseCaseDetails on the saved case-with-acts sample.
import { readFileSync } from "node:fs";
import { parseCaseDetails } from "../src/sudrf/case-parser.js";

const html = readFileSync(new URL("./case_acts_sample.html", import.meta.url), "utf8");
const d = parseCaseDetails(html, "Октябрьский районный суд г. Саранска", "/modules.php?name=sud_delo&case_id=155820227");

console.log("caseNumber:", d.caseNumber);
console.log("caseUid:", d.caseUid);
console.log("category:", d.category);
console.log("judge:", d.judge);
console.log("entryDate:", d.entryDate, "| resultDate:", d.resultDate, "| status:", d.status);
console.log("firstInstance:", JSON.stringify(d.firstInstance));
console.log("plaintiff:", d.plaintiff, "| defendant:", d.defendant);
console.log("participants:", d.participants.length);
console.log(JSON.stringify(d.participants.slice(0, 3), null, 2));
console.log("events:", d.events.length);
console.log(JSON.stringify(d.events.slice(0, 3), null, 2));
console.log("documents:", d.documents.length);
for (const doc of d.documents) {
  console.log(`  doc[${doc.docId}] name="${doc.name}" caseNo="${doc.caseNumber}" date="${doc.date}" textLen=${doc.text.length}`);
  console.log("  text head:", doc.text.slice(0, 200));
}
