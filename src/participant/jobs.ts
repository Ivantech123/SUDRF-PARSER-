// Background jobs for deep participant search (Tier-2, multi-court).

import { randomBytes } from "node:crypto";
import type { CaseSearchResult } from "../sudrf/types.js";

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface ParticipantSearchJob {
  id: string;
  name: string;
  region?: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  progress: {
    done: number;
    total: number;
    current?: string;
  };
  courts: string[];
  deloIds: number[];
  results: Array<CaseSearchResult & { court: string; category: string; subdomain: string }>;
  errors: Array<{ court: string; deloId: number; error: string }>;
  error?: string;
}

const JOB_TTL_MS = 24 * 60 * 60 * 1000;

export class ParticipantSearchJobStore {
  private jobs = new Map<string, ParticipantSearchJob>();

  create(params: {
    name: string;
    region?: string;
    courts: string[];
    deloIds: number[];
  }): ParticipantSearchJob {
    this.prune();
    const id = randomBytes(12).toString("base64url");
    const total = params.courts.length * params.deloIds.length;
    const job: ParticipantSearchJob = {
      id,
      name: params.name,
      region: params.region,
      status: "queued",
      createdAt: new Date().toISOString(),
      progress: { done: 0, total },
      courts: params.courts,
      deloIds: params.deloIds,
      results: [],
      errors: [],
    };
    this.jobs.set(id, job);
    return job;
  }

  get(id: string): ParticipantSearchJob | undefined {
    return this.jobs.get(id);
  }

  update(id: string, patch: Partial<ParticipantSearchJob>): ParticipantSearchJob | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    Object.assign(job, patch);
    return job;
  }

  private prune(): void {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, job] of this.jobs) {
      const t = Date.parse(job.finishedAt ?? job.createdAt);
      if (t < cutoff) this.jobs.delete(id);
    }
  }
}
