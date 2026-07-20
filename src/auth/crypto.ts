// Password hashing + session/key token generation via node:crypto scrypt.
// No external deps — scrypt is built into Node and runs synchronously fast
// enough for an invite-only service with a handful of users.

import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

const KEY_LEN = 64;   // scrypt output length, bytes
const SALT_LEN = 16;  // salt length, bytes

// Hash a password → "saltHex:hashHex" string safe to store in JSON.
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN);
  const hash = scryptSync(password, salt, KEY_LEN);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

// Constant-time compare of a plaintext password against a stored
// "saltHex:hashHex" string. Returns false on malformed stored values.
export function verifyPassword(password: string, stored: string): boolean {
  const sep = stored.indexOf(":");
  if (sep <= 0) return false;
  const salt = Buffer.from(stored.slice(0, sep), "hex");
  const hash = Buffer.from(stored.slice(sep + 1), "hex");
  if (salt.length === 0 || hash.length === 0) return false;
  const candidate = scryptSync(password, salt, KEY_LEN);
  if (candidate.length !== hash.length) return false;
  return timingSafeEqual(candidate, hash);
}

// Cryptographically random token: hex string, 32 bytes → 64 chars.
// Used for both session cookies and MCP bearer keys.
export function randomToken(): string {
  return randomBytes(32).toString("hex");
}
