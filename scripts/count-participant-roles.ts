import { CaseCatalog } from "../src/cases/store.js";

const c = new CaseCatalog();
c.load("./cases-store.json");
const roles = new Map<string, number>();
let withRep = 0;
let totalP = 0;
let casesWithParticipants = 0;
c.forEach((x) => {
  if (x.participants?.length) casesWithParticipants++;
  for (const p of x.participants ?? []) {
    totalP++;
    const r = (p.role || "?").trim().toUpperCase();
    roles.set(r, (roles.get(r) ?? 0) + 1);
    if (/ПРЕДСТАВ|АДВОКАТ|ЗАЩИТН|ЮРИСКОНС/.test(r)) withRep++;
  }
});
console.log(
  JSON.stringify(
    {
      cases: c.size,
      casesWithParticipants,
      participants: totalP,
      withRepRole: withRep,
      top: [...roles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
    },
    null,
    2,
  ),
);
