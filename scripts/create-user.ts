#!/usr/bin/env node
// Admin CLI: create / list / delete users in the auth store.
// Invite-only — there is no signup endpoint, users are created here.
//
// Usage (run from repo root, via tsx in dev or node dist after build):
//   npx tsx scripts/create-user.ts add  user@example.com 'pa$$word' [--admin]
//   npx tsx scripts/create-user.ts list
//   npx tsx scripts/create-user.ts del  <userId>
//   npx tsx scripts/create-user.ts key  <userId> [label]   # issue an MCP key
//
// The store path defaults to ./auth-store.json (next to dist/ in prod),
// override with SUDRF_AUTH_PATH. The MCP server must use the same path.

import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { AuthStore } from "../src/auth/store.js";

const arg = (n: number) => process.argv[n + 2] ?? ""; // skip "node script"
const cmd = arg(0);

const authPath = process.env.SUDRF_AUTH_PATH
  ?? fileURLToPath(new URL("../auth-store.json", import.meta.url));

const store = new AuthStore();
if (existsSync(authPath)) store.load(authPath);
store.setPath(authPath);

function usage(): never {
  console.error(`Usage:
  create-user add <email> <password> [--admin]   create a user
  create-user list                               list users
  create-user del <userId>                       delete a user (cascades keys/sessions)
  create-user key <userId> [label]               issue an MCP bearer key for a user
Env: SUDRF_AUTH_PATH (default ./auth-store.json)`);
  process.exit(2);
}

switch (cmd) {
  case "add": {
    const email = arg(1);
    const password = arg(2);
    const admin = arg(3) === "--admin" || arg(4) === "--admin";
    if (!email || !password) usage();
    try {
      const u = store.createUser(email, password, admin ? "admin" : "user");
      console.log(`created user ${u.email} (id=${u.id}, role=${u.role})`);
    } catch (e) {
      console.error(`error: ${(e as Error).message}`);
      process.exit(1);
    }
    break;
  }
  case "list": {
    const users = store.listUsers();
    if (!users.length) { console.log("(no users)"); break; }
    for (const u of users) {
      const keys = store.listKeysForUser(u.id).length;
      console.log(`${u.id}  ${u.email}  ${u.role}  keys=${keys}  created=${u.createdAt}`);
    }
    break;
  }
  case "del": {
    const id = arg(1);
    if (!id) usage();
    console.log(store.deleteUser(id) ? `deleted ${id}` : `not found: ${id}`);
    break;
  }
  case "key": {
    const id = arg(1);
    const label = arg(2) || "default";
    if (!id) usage();
    try {
      const k = store.createKey(id, label);
      console.log(`key created for user ${id} (label=${label})`);
      console.log(`token: ${k.token}`);
      console.log(`use as: Authorization: Bearer ${k.token}`);
    } catch (e) {
      console.error(`error: ${(e as Error).message}`);
      process.exit(1);
    }
    break;
  }
  default:
    usage();
}
