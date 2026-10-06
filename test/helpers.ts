import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Captured sud_delo pages live in scripts/ and are already stored decoded as
 * UTF-8 (their <meta> still advertises windows-1251 — that is what the live
 * server sent, and fetchSudrf decodes it before the parsers ever see it).
 */
export function fixture(name: string): string {
  return readFileSync(resolve(here, "..", "scripts", name), "utf8");
}
