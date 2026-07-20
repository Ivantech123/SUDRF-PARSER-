// Early-access waitlist — JSON file, no auth required to submit.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

export interface WaitlistEntry {
  id: string;
  email: string;
  name: string;
  note: string;
  createdAt: string;
  /** ISO timestamp when privacy consent was given */
  consentedAt?: string;
  privacyVersion?: string;
}

export class WaitlistStore {
  private entries: WaitlistEntry[] = [];
  private path: string;

  constructor(path: string) {
    this.path = path;
    this.load();
  }

  add(input: {
    email: string;
    name?: string;
    note?: string;
    consent?: boolean;
    privacyVersion?: string;
  }): WaitlistEntry {
    if (!input.consent) {
      throw new Error("нужно согласие с политикой обработки данных");
    }
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("укажите корректный email");
    }
    const existing = this.entries.find((e) => e.email === email);
    if (existing) return existing;

    const now = new Date().toISOString();
    const entry: WaitlistEntry = {
      id: randomBytes(8).toString("hex"),
      email,
      name: (input.name ?? "").trim().slice(0, 120),
      note: (input.note ?? "").trim().slice(0, 500),
      createdAt: now,
      consentedAt: now,
      privacyVersion: (input.privacyVersion ?? "2026-07-20").slice(0, 32),
    };
    this.entries.push(entry);
    this.save();
    return entry;
  }

  list(): WaitlistEntry[] {
    return [...this.entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private load() {
    try {
      if (!existsSync(this.path)) return;
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as { entries?: WaitlistEntry[] };
      this.entries = Array.isArray(raw.entries) ? raw.entries : [];
    } catch {
      this.entries = [];
    }
  }

  private save() {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify({ entries: this.entries }, null, 2), "utf8");
  }
}

let singleton: WaitlistStore | null = null;

export function getWaitlistStore(): WaitlistStore {
  if (!singleton) {
    const path =
      process.env.SUDRF_WAITLIST_PATH
      ?? join(process.cwd(), "data", "waitlist.json");
    singleton = new WaitlistStore(path);
  }
  return singleton;
}
