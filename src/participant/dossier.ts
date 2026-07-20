// Unified participant/lawyer dossier — one entry point for "find practice" tasks.
//
// Fast path (sync): resolve courts + local catalog + RAG corpus.
// Deep path (async): Tier-2 search_cases across courts × categories via job queue.

import type { SudrfClient } from "../sudrf/index.js";
import type { RagIndex } from "../rag/index.js";
import type { CaseCatalog, CaseListItem } from "../cases/store.js";
import { resolveCourtQuery, searchCourts, type CourtSearchHit } from "../sudrf/court-search.js";
import { CASE_CATEGORIES } from "../sudrf/categories.js";
import { ParticipantSearchJobStore, type ParticipantSearchJob } from "./jobs.js";

export interface ParticipantSearchInput {
  name: string;
  region?: string;
  courts?: string[];
  deepSearch?: boolean;
  maxCourts?: number;
  deloIds?: number[];
}

export interface ParticipantDossier {
  query: { name: string; region?: string };
  summary: string;
  courts: {
    resolved: CourtSearchHit[];
    ambiguous: boolean;
    hint: string;
  };
  local: {
    catalog: { total: number; cases: CaseListItem[] };
    rag: {
      total: number;
      corpusCases: number;
      hits: Array<{
        score: number;
        caseUid?: string;
        caseNumber?: string;
        court?: string;
        actType?: string;
        actDate?: string;
        text: string;
      }>;
    };
  };
  deepSearch?: {
    jobId: string;
    status: ParticipantSearchJob["status"];
    message: string;
    pollWith: "get_participant_search";
  };
  limits: {
    note: string;
    arbitration: string;
  };
}

const DEFAULT_DELO_IDS = [5, 4, 41]; // civil, criminal, appeal

function pickCourts(input: ParticipantSearchInput): CourtSearchHit[] {
  if (input.courts?.length) {
    return input.courts.map((sub) => {
      const hit = searchCourts(sub, 1)[0];
      return hit ?? {
        subdomain: sub,
        name: sub,
        region: "",
        type: "other" as const,
        vnkod: "",
        captcha: true,
        http: false,
        score: 0,
        matchReason: "explicit",
      };
    });
  }

  const queries = [input.region, input.name].filter(Boolean) as string[];
  const seen = new Set<string>();
  const out: CourtSearchHit[] = [];

  for (const q of queries) {
    if (!q) continue;
    const r = resolveCourtQuery(q);
    for (const c of r.candidates) {
      if (seen.has(c.subdomain)) continue;
      seen.add(c.subdomain);
      out.push(c);
    }
  }

  // Prefer district/supreme courts in the region over random matches.
  out.sort((a, b) => {
    const rank = (t: string) => ({ vs: 0, oblsud: 1, ray: 2, garb: 3, other: 4 }[t] ?? 5);
    return rank(a.type) - rank(b.type) || b.score - a.score;
  });

  return out.slice(0, input.maxCourts ?? 5);
}

function buildSummary(name: string, catalogTotal: number, ragTotal: number, courts: CourtSearchHit[]): string {
  const courtNames = courts.slice(0, 3).map((c) => c.name).join("; ");
  const parts = [
    `Запрос: «${name}».`,
    catalogTotal > 0
      ? `В локальном каталоге парсера: ${catalogTotal} дел.`
      : "В локальном каталоге парсера совпадений нет (каталог наполняется постепенно).",
    ragTotal > 0
      ? `В индексе текстов актов (RAG): ${ragTotal} фрагментов.`
      : "В RAG-индексе совпадений нет — проиндексируйте дела через index_case.",
    courts.length
      ? `Суды для глубокого поиска: ${courtNames}${courts.length > 3 ? "…" : ""}.`
      : "Суды не определены — укажите region или courts.",
    "ГАС «Правосудие» (sudrf.ru) — суды общей юрисдикции; kad.arbitr.ru (арбитраж) не покрывается.",
  ];
  return parts.join(" ");
}

export function buildParticipantDossier(
  input: ParticipantSearchInput,
  catalog: CaseCatalog | undefined,
  rag: RagIndex
): Omit<ParticipantDossier, "deepSearch"> & { courtsResolved: CourtSearchHit[] } {
  const name = input.name.trim();
  const resolved = pickCourts(input);
  const ambiguous = resolved.length > 1 && resolved[0].score - (resolved[1]?.score ?? 0) < 40;

  const catalogResult = catalog?.list({ q: name, limit: 30 }) ?? { total: 0, cases: [] as CaseListItem[] };
  const ragRes = rag.search(name, 15);

  const ragHits = ragRes.hits.map((h) => ({
    score: Number(h.score.toFixed(4)),
    caseUid: h.chunk.caseUid,
    caseNumber: h.chunk.caseNumber,
    court: h.chunk.court,
    actType: h.chunk.docName,
    actDate: h.chunk.docDate,
    text: h.chunk.text.slice(0, 500),
  }));

  return {
    query: { name, region: input.region },
    summary: buildSummary(name, catalogResult.total, ragHits.length, resolved),
    courts: {
      resolved,
      ambiguous,
      hint: ambiguous
        ? "Несколько подходящих судов — уточните region или передайте courts[] явно."
        : resolved.length
          ? `Используйте subdomain ${resolved[0].subdomain} для точечных запросов.`
          : "Укажите region (напр. «Мордовия», «Саранск») или courts (напр. oktyabrsky--mor).",
    },
    local: {
      catalog: catalogResult as { total: number; cases: CaseListItem[] },
      rag: {
        total: ragHits.length,
        corpusCases: rag.caseCount,
        hits: ragHits,
      },
    },
    limits: {
      note: "deepSearch=true запускает фоновый обход sudrf.ru (капча, ~1–3 мин на суд).",
      arbitration: "Арбитраж (kad.arbitr.ru) в этом коннекторе недоступен.",
    },
    courtsResolved: resolved,
  };
}

export async function runParticipantDeepSearch(
  jobStore: ParticipantSearchJobStore,
  client: SudrfClient,
  jobId: string
): Promise<void> {
  const job = jobStore.get(jobId);
  if (!job || job.status !== "queued") return;

  jobStore.update(jobId, { status: "running", startedAt: new Date().toISOString() });

  const seen = new Set<string>();

  try {
    for (const subdomain of job.courts) {
      for (const deloId of job.deloIds) {
        const cur = jobStore.get(jobId)!;
        const cat = CASE_CATEGORIES.find((c) => c.deloId === deloId);
        const label = cat?.label ?? String(deloId);

        jobStore.update(jobId, {
          progress: {
            done: cur.progress.done,
            total: cur.progress.total,
            current: `${subdomain} / ${label}`,
          },
        });

        try {
          const res = await client.searchCases(subdomain, deloId, {
            participantName: job.name,
          });
          const fresh = jobStore.get(jobId)!;
          for (const r of res.results) {
            const key = `${subdomain}:${r.caseNumber}:${r.caseUid ?? ""}`;
            if (seen.has(key)) continue;
            seen.add(key);
            fresh.results.push({
              ...r,
              court: res.court,
              category: res.category,
              subdomain,
            });
          }
          fresh.progress.done++;
          jobStore.update(jobId, {
            progress: fresh.progress,
            results: fresh.results,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const fresh = jobStore.get(jobId)!;
          fresh.errors.push({ court: subdomain, deloId, error: msg });
          fresh.progress.done++;
          jobStore.update(jobId, {
            progress: fresh.progress,
            errors: fresh.errors,
          });
        }
      }
    }

    jobStore.update(jobId, {
      status: "done",
      finishedAt: new Date().toISOString(),
      progress: { done: job.progress.total, total: job.progress.total },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    jobStore.update(jobId, { status: "failed", error: msg, finishedAt: new Date().toISOString() });
  }
}

export function startParticipantDeepSearch(
  jobStore: ParticipantSearchJobStore,
  client: SudrfClient,
  input: ParticipantSearchInput,
  courts: CourtSearchHit[]
): ParticipantSearchJob {
  const deloIds = input.deloIds?.length ? input.deloIds : DEFAULT_DELO_IDS;
  const subdomains = courts.map((c) => c.subdomain);
  const job = jobStore.create({
    name: input.name.trim(),
    region: input.region,
    courts: subdomains,
    deloIds,
  });

  // Fire-and-forget — MCP/HTTP returns jobId immediately.
  void runParticipantDeepSearch(jobStore, client, job.id);
  return job;
}

export function formatParticipantSearchJob(job: ParticipantSearchJob): Record<string, unknown> {
  return {
    jobId: job.id,
    name: job.name,
    region: job.region,
    status: job.status,
    progress: job.progress,
    resultsCount: job.results.length,
    results: job.results,
    errors: job.errors,
    error: job.error,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  };
}
