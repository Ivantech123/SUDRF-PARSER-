#!/usr/bin/env npx tsx
/** Export COURT_REGISTRY to JSON for the Go parser-worker. */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COURT_REGISTRY } from "../src/sudrf/courts.js";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "parser-worker", "data", "courts-registry.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(COURT_REGISTRY), "utf8");
console.log(`Wrote ${COURT_REGISTRY.length} courts → ${out}`);
