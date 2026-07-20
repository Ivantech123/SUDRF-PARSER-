import { CaseCatalog } from "../src/cases/store.js";
import { listParticipants, warmParticipantIndex } from "../src/participants/aggregate.js";

const c = new CaseCatalog();
c.load("./cases-store.json");
warmParticipantIndex(c);
const r = listParticipants(c, { role: "representative", limit: 8 });
console.log(
  JSON.stringify(
    {
      totalRepPeople: r.total,
      facets: r.facets,
      sample: r.people.slice(0, 8).map((p) => ({ name: p.name, cases: p.cases, roles: p.roles })),
      casesWithRepRole: c.list({ participantRole: "representative", limit: 1 }).total,
    },
    null,
    2,
  ),
);
