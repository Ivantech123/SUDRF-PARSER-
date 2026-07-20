/**
 * Strip act texts from cases-store.json (bodies live in RAG).
 *
 *   npx tsx scripts/compact-catalog.ts
 */
import { resolve } from "node:path";
import { statSync, existsSync } from "node:fs";
import { CaseCatalog } from "../src/cases/store.js";

const path = resolve(process.env.SUDRF_CASES_PATH || "./cases-store.json");
const before = existsSync(path) ? statSync(path).size : 0;

const catalog = new CaseCatalog();
catalog.setPath(path);
catalog.load(path);
const stripped = catalog.compactActTexts();
catalog.flush();

const after = existsSync(path) ? statSync(path).size : 0;
console.log(
  JSON.stringify(
    {
      path,
      cases: catalog.size,
      strippedDocs: stripped,
      beforeMB: Math.round((before / 1024 / 1024) * 10) / 10,
      afterMB: Math.round((after / 1024 / 1024) * 10) / 10,
      savedMB: Math.round(((before - after) / 1024 / 1024) * 10) / 10,
    },
    null,
    2,
  ),
);
