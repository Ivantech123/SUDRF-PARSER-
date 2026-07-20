// Auth store: users, per-user MCP keys, and login sessions.
//
// Storage layout (single JSON file, same pattern as RagIndex):
//   {
//     users:   { [userId]: { id, email, passHash, role, createdAt } },
//     keys:    { [keyId]:  { id, userId, token, label, createdAt, lastUsedAt? } },
//     sessions:{ [sessionId]: { id, userId, createdAt, expiresAt } }
//   }
// The MCP bearer key the client sends is `keys[*].token`; we look it up
// directly (token is the primary access path, so it's the map key in a
// reverse index kept in memory for O(1) /mcp auth).
//
// Invite-only: no signup endpoint. Users are created by the admin CLI
// (scripts/create-user.ts) which calls createUser() below.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { hashPassword, verifyPassword, randomToken } from "./crypto.js";

export type Role = "admin" | "user";

export interface UserProfile {
  firstName: string;
  lastName: string;
  patronymic?: string;
  city?: string;
  company?: string;
  bio?: string;
  /** Роль в судебной системе — для персональной игровой карточки */
  participantRole?: "lawyer" | "judge" | "other";
  /** Когда последний раз меняли participantRole (лимит — раз в 30 дней) */
  participantRoleChangedAt?: string;
}

export interface User {
  id: string;
  email: string;
  passHash: string;
  role: Role;
  createdAt: string;   // ISO
  profile?: UserProfile;
  invitedBy?: string;
}

export interface Invite {
  id: string;
  token: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  usedBy?: string;
}

export interface ApiKey {
  id: string;
  userId: string;
  token: string;       // the bearer secret sent as Authorization: Bearer <token>
  label: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface Session {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;   // ISO
}

interface StoreShape {
  version: number;
  users: Record<string, User>;
  keys: Record<string, ApiKey>;
  sessions: Record<string, Session>;
  invites?: Record<string, Invite>;
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const INVITES_PER_WEEK = 4;
const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const PARTICIPANT_ROLE_CHANGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export class ProfileUpdateError extends Error {
  constructor(
    message: string,
    public readonly code: "role_change_cooldown",
    public readonly nextChangeAt: string,
  ) {
    super(message);
    this.name = "ProfileUpdateError";
  }
}

export function participantRoleChangeInfo(profile?: UserProfile): {
  canChange: boolean;
  nextChangeAt?: string;
} {
  const at = profile?.participantRoleChangedAt;
  if (!at) return { canChange: true };
  const next = Date.parse(at) + PARTICIPANT_ROLE_CHANGE_MS;
  if (Date.now() >= next) return { canChange: true };
  return { canChange: false, nextChangeAt: new Date(next).toISOString() };
}

export class AuthStore {
  private users = new Map<string, User>();          // userId → user
  private keys = new Map<string, ApiKey>();         // keyId → key
  private sessions = new Map<string, Session>();    // sessionId → session
  private tokenIndex = new Map<string, ApiKey>();   // token → key (fast /mcp auth)
  private emailIndex = new Map<string, User>();     // email(lower) → user (login)
  private invites = new Map<string, Invite>();      // inviteId → invite
  private inviteTokenIndex = new Map<string, Invite>(); // token → invite

  private path: string | null = null;
  private dirty = false;

  updateProfile(userId: string, patch: Partial<UserProfile>): User | undefined {
    const user = this.users.get(userId);
    if (!user) return undefined;

    const prev = user.profile ?? { firstName: "", lastName: "" };
    const merged: UserProfile = { ...prev, ...patch };

    if (patch.participantRole !== undefined) {
      const oldRole = prev.participantRole ?? "other";
      const newRole = patch.participantRole;
      if (newRole !== oldRole) {
        const { canChange, nextChangeAt } = participantRoleChangeInfo(prev);
        if (!canChange && nextChangeAt) {
          throw new ProfileUpdateError(
            "Роль можно менять раз в месяц",
            "role_change_cooldown",
            nextChangeAt,
          );
        }
        merged.participantRoleChangedAt = new Date().toISOString();
      } else {
        merged.participantRoleChangedAt = prev.participantRoleChangedAt;
      }
    }

    user.profile = merged;
    this.dirty = true;
    this.saveIfPath();
    return user;
  }

  // ── Invites (4 per rolling week per user) ─────────────────────────────
  invitesThisWeek(userId: string): number {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return [...this.invites.values()].filter(
      (i) => i.createdBy === userId && Date.parse(i.createdAt) >= weekAgo,
    ).length;
  }

  createInvite(userId: string): Invite {
    if (!this.users.has(userId)) throw new Error("user not found");
    if (this.invitesThisWeek(userId) >= INVITES_PER_WEEK) {
      throw new Error(`лимит ${INVITES_PER_WEEK} приглашений в неделю исчерпан`);
    }
    const now = Date.now();
    const invite: Invite = {
      id: randomToken().slice(0, 12),
      token: randomToken(),
      createdBy: userId,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + INVITE_TTL_MS).toISOString(),
    };
    this.invites.set(invite.id, invite);
    this.inviteTokenIndex.set(invite.token, invite);
    this.dirty = true;
    this.saveIfPath();
    return invite;
  }

  listInvitesForUser(userId: string): Invite[] {
    return [...this.invites.values()]
      .filter((i) => i.createdBy === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  findInviteByToken(token: string): Invite | undefined {
    const invite = this.inviteTokenIndex.get(token.trim());
    if (!invite) return undefined;
    if (invite.usedAt) return undefined;
    if (Date.parse(invite.expiresAt) < Date.now()) return undefined;
    return invite;
  }

  registerWithInvite(
    token: string,
    email: string,
    password: string,
    profile: UserProfile,
  ): User {
    const invite = this.findInviteByToken(token);
    if (!invite) throw new Error("приглашение недействительно или истекло");
    const user = this.createUser(email, password, "user", profile, invite.createdBy);
    invite.usedAt = new Date().toISOString();
    invite.usedBy = user.id;
    this.dirty = true;
    this.saveIfPath();
    return user;
  }

  // ── Users ──────────────────────────────────────────────────────────────
  createUser(
    email: string,
    password: string,
    role: Role = "user",
    profile?: UserProfile,
    invitedBy?: string,
  ): User {
    const norm = email.trim().toLowerCase();
    if (!norm) throw new Error("email required");
    if (this.emailIndex.has(norm)) throw new Error(`user ${norm} already exists`);
    const user: User = {
      id: randomToken().slice(0, 16),
      email: norm,
      passHash: hashPassword(password),
      role,
      createdAt: new Date().toISOString(),
      profile,
      invitedBy,
    };
    this.users.set(user.id, user);
    this.emailIndex.set(norm, user);
    this.dirty = true;
    this.saveIfPath();
    return user;
  }

  getUserById(id: string): User | undefined {
    return this.users.get(id);
  }

  // Verify email+password. Returns the user on success, undefined otherwise.
  // Slow path (scrypt) only runs when the email is known.
  verifyCredentials(email: string, password: string): User | undefined {
    const user = this.emailIndex.get(email.trim().toLowerCase());
    if (!user) return undefined;
    return verifyPassword(password, user.passHash) ? user : undefined;
  }

  listUsers(): User[] {
    return [...this.users.values()];
  }

  setUserRole(id: string, role: Role): User | undefined {
    const user = this.users.get(id);
    if (!user) return undefined;
    if (user.role === role) return user;
    user.role = role;
    this.dirty = true;
    this.saveIfPath();
    return user;
  }

  /** Promote the N oldest accounts to admin (bootstrap for early access). */
  ensureBootstrapAdmins(count = 2): string[] {
    const sorted = [...this.users.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    const promoted: string[] = [];
    for (const u of sorted.slice(0, count)) {
      if (u.role !== "admin") {
        u.role = "admin";
        promoted.push(u.email);
      }
    }
    if (promoted.length) {
      this.dirty = true;
      this.saveIfPath();
    }
    return promoted;
  }

  deleteUser(id: string): boolean {
    const user = this.users.get(id);
    if (!user) return false;
    // cascade: drop keys + sessions
    for (const k of [...this.keys.values()]) {
      if (k.userId === id) {
        this.keys.delete(k.id);
        this.tokenIndex.delete(k.token);
      }
    }
    for (const s of [...this.sessions.values()]) {
      if (s.userId === id) this.sessions.delete(s.id);
    }
    this.users.delete(id);
    this.emailIndex.delete(user.email);
    this.dirty = true;
    this.saveIfPath();
    return true;
  }

  // ── API keys ───────────────────────────────────────────────────────────
  // Create a new MCP bearer key for a user. Returns the key incl. the secret
  // token (only shown once at creation in the cabinet).
  createKey(userId: string, label = "default"): ApiKey {
    if (!this.users.has(userId)) throw new Error("user not found");
    const key: ApiKey = {
      id: randomToken().slice(0, 16),
      userId,
      token: randomToken(),
      label,
      createdAt: new Date().toISOString(),
    };
    this.keys.set(key.id, key);
    this.tokenIndex.set(key.token, key);
    this.dirty = true;
    this.saveIfPath();
    return key;
  }

  // Look up a key by its bearer token (the /mcp auth path). Updates lastUsedAt.
  findKeyByToken(token: string): ApiKey | undefined {
    const key = this.tokenIndex.get(token);
    if (!key) return undefined;
    key.lastUsedAt = new Date().toISOString();
    this.dirty = true;
    // don't save on every /mcp call (hot path) — caller can flush periodically
    return key;
  }

  listKeysForUser(userId: string): ApiKey[] {
    return [...this.keys.values()].filter((k) => k.userId === userId);
  }

  deleteKey(userId: string, keyId: string): boolean {
    const key = this.keys.get(keyId);
    if (!key || key.userId !== userId) return false;
    this.keys.delete(keyId);
    this.tokenIndex.delete(key.token);
    this.dirty = true;
    this.saveIfPath();
    return true;
  }

  // ── Sessions ───────────────────────────────────────────────────────────
  // Create a login session. Returns the session id to set as a cookie.
  createSession(userId: string): string {
    const id = randomToken();
    const now = Date.now();
    const session: Session = {
      id,
      userId,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    };
    this.sessions.set(id, session);
    this.dirty = true;
    this.saveIfPath();
    return id;
  }

  // Resolve a session cookie → user. Expires stale sessions lazily.
  getUserBySession(sessionId: string): User | undefined {
    const s = this.sessions.get(sessionId);
    if (!s) return undefined;
    if (Date.parse(s.expiresAt) < Date.now()) {
      this.sessions.delete(s.id);
      this.dirty = true;
      this.saveIfPath();
      return undefined;
    }
    return this.users.get(s.userId);
  }

  destroySession(sessionId: string): void {
    if (this.sessions.delete(sessionId)) {
      this.dirty = true;
      this.saveIfPath();
    }
  }

  // ── Persistence ────────────────────────────────────────────────────────
  load(path: string): void {
    this.path = path;
    if (!existsSync(path)) return;
    const data = JSON.parse(readFileSync(path, "utf8")) as StoreShape;
    this.users.clear();
    this.keys.clear();
    this.sessions.clear();
    this.tokenIndex.clear();
    this.emailIndex.clear();
    for (const u of Object.values(data.users ?? {})) {
      this.users.set(u.id, u);
      this.emailIndex.set(u.email, u);
    }
    for (const k of Object.values(data.keys ?? {})) {
      this.keys.set(k.id, k);
      this.tokenIndex.set(k.token, k);
    }
    for (const s of Object.values(data.sessions ?? {})) {
      this.sessions.set(s.id, s);
    }
    for (const inv of Object.values(data.invites ?? {})) {
      this.invites.set(inv.id, inv);
      this.inviteTokenIndex.set(inv.token, inv);
    }
    this.dirty = false;
  }

  setPath(path: string): void {
    this.path = path;
  }

  private saveIfPath(): void {
    if (!this.path) return;
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const payload: StoreShape = {
      version: 1,
      users: Object.fromEntries(this.users),
      keys: Object.fromEntries(this.keys),
      sessions: Object.fromEntries(this.sessions),
      invites: Object.fromEntries(this.invites),
    };
    writeFileSync(this.path, JSON.stringify(payload, null, 2), "utf8");
    this.dirty = false;
  }

  // Force a flush (e.g. on shutdown) — /mcp auth updates lastUsedAt without
  // saving, so the periodic/shutdown flush persists it.
  flush(): void {
    if (this.path && this.dirty) this.saveIfPath();
  }
}
