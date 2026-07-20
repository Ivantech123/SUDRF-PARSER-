// Smoke test for the auth store: password verify + key lookup (the /mcp path).
// Run: SUDRF_AUTH_PATH=./scripts/.auth-smoke.json npx tsx scripts/test-auth.ts
import { AuthStore } from "../src/auth/store.js";

const path = process.env.SUDRF_AUTH_PATH;
if (!path) { console.error("set SUDRF_AUTH_PATH"); process.exit(2); }

const s = new AuthStore();
s.load(path);

const u = s.verifyCredentials("tester@synapsex.local", "test-pass-123");
console.log("verify correct password →", u ? u.email : "FAIL");

const bad = s.verifyCredentials("tester@synapsex.local", "wrong");
console.log("verify wrong password   →", bad ? "FAIL" : "null OK");

const u2 = s.verifyCredentials("nobody@nowhere.test", "x");
console.log("verify unknown email     →", u2 ? "FAIL" : "null OK");

const keys = u ? s.listKeysForUser(u.id) : [];
const token = keys[0]?.token;
console.log("issued keys for user     →", keys.length, "| label:", keys[0]?.label);

const k = token ? s.findKeyByToken(token) : undefined;
console.log("findKeyByToken valid     →", k ? k.label : "FAIL");
console.log("findKeyByToken invalid   →", s.findKeyByToken("deadbeef") ? "FAIL" : "null OK");

const sid = u ? s.createSession(u.id) : "";
console.log("createSession            →", sid ? "ok" : "FAIL");
const bySid = s.getUserBySession(sid);
console.log("getUserBySession valid   →", bySid ? bySid.email : "FAIL");
s.destroySession(sid);
console.log("getUserBySession after destroy →", s.getUserBySession(sid) ? "FAIL" : "null OK");
