// REST API routes exposing the same tools as MCP for non-MCP clients.
// All endpoints require authentication via Bearer token (either OAuth access
// token with prefix oat_ or legacy cabinet key).

import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { SudrfClient } from "../sudrf/index.js";
import type { RagIndex } from "../rag/index.js";
import type { AuthStore } from "../auth/store.js";
import type { OAuthStore } from "../auth/oauth.js";
import type { CaseParserScheduler } from "../parser/scheduler.js";
import type { CaseCatalog } from "../cases/store.js";
import type { ParticipantSearchJobStore } from "../participant/jobs.js";
import { serializeParserStats } from "../parser/stats-view.js";
import { computeCoverage } from "../analytics/coverage.js";
import { resolveEntity } from "../entities/index.js";
import type { Tier2ParserScheduler } from "../parser/tier2-scheduler.js";
import {
  CatalogListSchema,
  SearchCollectedSchema,
  CatalogDocumentSchema,
  listCatalogCases,
  searchCollectedCatalog,
  getCatalogDocument,
} from "../catalog/tools.js";
import {
  ListLawyersSchema,
  GetLawyerCardSchema,
  GetParticipantDossierSchema,
  GetRepresentativesSummarySchema,
  runListLawyers,
  runGetLawyerCard,
  runGetParticipantDossier,
  compactMordoviaAnalytics,
  runRepresentativesSummary,
} from "../catalog/agent-tools.js";
import {
  buildParticipantDossier,
  startParticipantDeepSearch,
  formatParticipantSearchJob,
} from "../participant/dossier.js";
import { ACCESS_TOKEN_PREFIX } from "../auth/oauth.js";

// ── Request/Response helpers ─────────────────────────────────────────────
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => { data += chunk.toString("utf8"); });
    req.on("end", () => {
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

// Extract and validate auth token from Authorization header.
function extractToken(req: IncomingMessage): string | null {
  const authHeader = req.headers["authorization"] ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  return m ? m[1].trim() : null;
}

// Authenticate request: returns userId if valid token, null otherwise.
function authenticate(token: string | null, auth: AuthStore, oauth: OAuthStore): string | null {
  if (!token) return null;
  // OAuth access token (prefix oat_)
  if (token.startsWith(ACCESS_TOKEN_PREFIX)) {
    const tok = oauth.validateAccessToken(token);
    return tok ? tok.userId : null;
  }
  // Legacy cabinet key
  const key = auth.findKeyByToken(token);
  return key ? key.userId : null;
}

// ── Input schemas (same as MCP) ──────────────────────────────────────────
const HearingScheduleSchema = z.object({
  court: z.string().describe("Court subdomain or name/region."),
  date: z.string().describe("Hearing date as DD.MM.YYYY."),
});

const SearchCasesSchema = z.object({
  court: z.string(),
  delo_id: z.number(),
  caseNumber: z.string().optional(),
  uid: z.string().optional(),
  participantName: z.string().optional(),
  inn: z.string().optional(),
  kpp: z.string().optional(),
  ogrn: z.string().optional(),
  judge: z.string().optional(),
  entryDateFrom: z.string().optional(),
  entryDateTo: z.string().optional(),
  resultDateFrom: z.string().optional(),
  resultDateTo: z.string().optional(),
  lawArticle: z.string().optional(),
});

const ResolveCourtSchema = z.object({
  query: z.string(),
});

const CaseDetailsSchema = z.object({
  court: z.string(),
  caseUrl: z.string(),
  includeDocumentText: z.boolean().optional(),
});

const IndexCaseSchema = z.object({
  court: z.string(),
  caseUrl: z.string(),
  replace: z.boolean().optional(),
});

const SearchCaseTextsSchema = z.object({
  query: z.string(),
  limit: z.number().optional(),
  court: z.string().optional(),
  caseNumber: z.string().optional(),
});

const RemoveCaseSchema = z.object({
  caseUid: z.string(),
});

const ParticipantSearchSchema = z.object({
  name: z.string(),
  region: z.string().optional(),
  courts: z.array(z.string()).optional(),
  deepSearch: z.boolean().optional(),
  maxCourts: z.number().optional(),
  deloIds: z.array(z.number()).optional(),
});

const ParticipantJobSchema = z.object({
  jobId: z.string(),
});

// ── Route handler ────────────────────────────────────────────────────────
export async function handleRestApiRoute(
  req: IncomingMessage,
  res: ServerResponse,
  client: SudrfClient,
  rag: RagIndex,
  auth: AuthStore,
  oauth: OAuthStore,
  saveRag: () => void,
  scheduler?: CaseParserScheduler,
  catalog?: CaseCatalog,
  participantJobs?: ParticipantSearchJobStore,
  tier2Scheduler?: Tier2ParserScheduler,
): Promise<boolean> {
  const url = req.url ?? "";
  
  // All /rest/* routes require authentication
  if (!url.startsWith("/rest/")) return false;

  const token = extractToken(req);
  const userId = authenticate(token, auth, oauth);
  
  if (!userId) {
    sendError(res, 401, "Unauthorized. Provide a valid Bearer token.");
    return true;
  }

  // Parse endpoint from URL
  const path = url.replace(/^\/rest\//, "").split("?")[0];

  try {
    // GET endpoints (no body)
    if (req.method === "GET") {
      switch (path) {
        case "list_case_categories": {
          const cats = client.listCategories();
          sendJson(res, 200, cats);
          return true;
        }
        case "list_indexed_cases": {
          const cases = rag.listCases();
          sendJson(res, 200, {
            corpusSize: rag.size,
            caseCount: rag.caseCount,
            cases,
          });
          return true;
        }
        case "list_catalog_courts": {
          if (!catalog) {
            sendError(res, 503, "Case catalog not available");
            return true;
          }
          sendJson(res, 200, { courts: catalog.courts() });
          return true;
        }
        case "list_catalog_regions": {
          if (!catalog) {
            sendError(res, 503, "Case catalog not available");
            return true;
          }
          sendJson(res, 200, { regions: catalog.regions() });
          return true;
        }
        case "catalog_coverage": {
          if (!catalog) {
            sendError(res, 503, "Case catalog not available");
            return true;
          }
          sendJson(res, 200, computeCoverage(catalog, rag));
          return true;
        }
        case "list_catalog_categories": {
          if (!catalog) {
            sendError(res, 503, "Case catalog not available");
            return true;
          }
          sendJson(res, 200, { categories: catalog.categoryFacets() });
          return true;
        }
        default:
          // Try to parse GET with query params for simple lookups
          if (path === "resolve_entity" && req.url?.includes("?")) {
            if (!catalog) {
              sendError(res, 503, "Case catalog not available");
              return true;
            }
            const params = new URLSearchParams(req.url.split("?")[1]);
            const query = params.get("query") ?? params.get("q");
            if (!query) {
              sendError(res, 400, "Missing required parameter: query");
              return true;
            }
            const limit = Math.min(Number(params.get("limit") ?? 20), 50);
            sendJson(res, 200, resolveEntity(catalog, query, limit));
            return true;
          }
          if (path === "resolve_court" && req.url?.includes("?")) {
            const params = new URLSearchParams(req.url.split("?")[1]);
            const query = params.get("query");
            if (!query) {
              sendError(res, 400, "Missing required parameter: query");
              return true;
            }
            const result = client.resolveCourtWithCandidates(query);
            sendJson(res, 200, result);
            return true;
          }
          break;
      }
    }

    // POST endpoints (with JSON body)
    if (req.method === "POST") {
      const body = await readJsonBody(req);

      switch (path) {
        case "resolve_court": {
          const { query } = ResolveCourtSchema.parse(body);
          const result = client.resolveCourtWithCandidates(query);
          sendJson(res, 200, result);
          return true;
        }

        case "get_hearing_schedule": {
          const { court, date } = HearingScheduleSchema.parse(body);
          const schedule = await client.getHearingSchedule(court, date);
          sendJson(res, 200, schedule);
          return true;
        }

        case "search_cases": {
          const input = SearchCasesSchema.parse(body);
          const { court, delo_id, ...filters } = input;
          const results = await client.searchCases(court, delo_id, filters);
          sendJson(res, 200, results);
          return true;
        }

        case "get_case_details": {
          const { court, caseUrl, includeDocumentText } = CaseDetailsSchema.parse(body);
          const details = await client.getCaseDetails(court, caseUrl);
          
          if (includeDocumentText === false) {
            const stripped = {
              ...details,
              documents: details.documents.map(d => ({
                docId: d.docId,
                name: d.name,
                caseNumber: d.caseNumber,
                date: d.date,
                text: undefined,
                url: d.url,
              })),
            };
            sendJson(res, 200, stripped);
            return true;
          }
          
          sendJson(res, 200, details);
          return true;
        }

        case "index_case": {
          const { court, caseUrl, replace } = IndexCaseSchema.parse(body);
          const details = await client.getCaseDetails(court, caseUrl);
          const uid = details.caseUid ?? details.caseNumber ?? caseUrl;
          const added = rag.addCase(details, replace);
          
          if (added > 0) saveRag();
          
          sendJson(res, 200, {
            caseUid: uid || undefined,
            caseNumber: details.caseNumber || undefined,
            court: details.court,
            chunksAdded: added,
            alreadyIndexed: added === 0 && rag.hasCase(uid),
            corpusSize: rag.size,
            corpusCases: rag.caseCount,
          });
          return true;
        }

        case "search_case_texts": {
          const { query, limit, court, caseNumber } = SearchCaseTextsSchema.parse(body);
          const searchResults = rag.search(query, limit ?? 10);
          
          // Apply optional filters
          let hits = searchResults.hits;
          if (court) {
            const c = client.resolveCourt(court);
            hits = hits.filter(h => h.chunk.court === c.name || h.chunk.court?.includes(court));
          }
          if (caseNumber) {
            hits = hits.filter(h => h.chunk.caseNumber === caseNumber);
          }
          
          sendJson(res, 200, {
            query: searchResults.query,
            total: hits.length,
            corpusSize: rag.size,
            corpusCases: rag.caseCount,
            hits: hits.map(h => ({
              score: Number(h.score.toFixed(4)),
              caseUid: h.chunk.caseUid,
              caseNumber: h.chunk.caseNumber,
              court: h.chunk.court,
              actType: h.chunk.docName,
              actDate: h.chunk.docDate,
              chunkIndex: h.chunk.index,
              text: h.chunk.text,
            })),
          });
          return true;
        }

        case "remove_case": {
          const { caseUid } = RemoveCaseSchema.parse(body);
          const removed = rag.removeCase(caseUid);
          
          if (removed > 0) saveRag();
          
          sendJson(res, 200, {
            caseUid,
            chunksRemoved: removed,
            corpusSize: rag.size,
            corpusCases: rag.caseCount,
          });
          return true;
        }

        case "parser_stats": {
          if (!scheduler) {
            sendError(res, 503, "Parser scheduler not available");
            return true;
          }
          sendJson(res, 200, serializeParserStats(scheduler.getStats(), tier2Scheduler?.getStats()));
          return true;
        }

        case "list_catalog_cases": {
          if (!catalog) {
            sendError(res, 503, "Case catalog not available");
            return true;
          }
          const input = CatalogListSchema.parse(body ?? {});
          sendJson(res, 200, listCatalogCases(catalog, input));
          return true;
        }

        case "resolve_entity": {
          if (!catalog) {
            sendError(res, 503, "Case catalog not available");
            return true;
          }
          const { query, limit } = z.object({
            query: z.string().min(1),
            limit: z.number().int().min(1).max(50).optional(),
          }).parse(body ?? {});
          sendJson(res, 200, resolveEntity(catalog, query, limit ?? 20));
          return true;
        }

        case "case_search":
        case "search_collected": {
          if (!catalog) {
            sendError(res, 503, "Case catalog not available");
            return true;
          }
          const input = SearchCollectedSchema.parse(body ?? {});
          sendJson(res, 200, searchCollectedCatalog(catalog, rag, input));
          return true;
        }

        case "get_catalog_case": {
          if (!catalog) {
            sendError(res, 503, "Case catalog not available");
            return true;
          }
          const { id } = z.object({ id: z.string() }).parse(body ?? {});
          const c = catalog.get(id);
          if (!c) {
            sendError(res, 404, "not found");
            return true;
          }
          sendJson(res, 200, { case: c });
          return true;
        }

        case "get_catalog_document": {
          if (!catalog) {
            sendError(res, 503, "Case catalog not available");
            return true;
          }
          const { caseId, docId } = CatalogDocumentSchema.parse(body ?? {});
          try {
            const doc = await getCatalogDocument(catalog, rag, client, caseId, docId);
            sendJson(res, 200, doc);
          } catch (e) {
            sendError(res, 404, e instanceof Error ? e.message : String(e));
          }
          return true;
        }

        case "sync_catalog_case": {
          if (!catalog) {
            sendError(res, 503, "Case catalog not available");
            return true;
          }
          const input = z.object({
            id: z.string().optional(),
            court: z.string().optional(),
            caseUrl: z.string().optional(),
          }).parse(body ?? {});
          let subdomain = input.court;
          let caseUrl = input.caseUrl;
          let id = input.id;
          if (id) {
            const existing = catalog.get(id);
            if (!existing) {
              sendError(res, 404, "not found");
              return true;
            }
            subdomain = existing.courtSubdomain;
            caseUrl = existing.caseUrl;
            if (!caseUrl) {
              sendError(res, 400, "case has no caseUrl");
              return true;
            }
          }
          if (!subdomain || !caseUrl) {
            sendError(res, 400, "id or (court + caseUrl) required");
            return true;
          }
          const details = await client.getCaseDetails(subdomain, caseUrl);
          const resolvedId = id ?? (details.caseUid ?? `${subdomain}:${details.caseNumber}`);
          const chunks = rag.addCase(details, true);
          const changes = catalog.enrichFromDetails(resolvedId, details, chunks > 0);
          if (chunks > 0) saveRag();
          catalog.flush();
          sendJson(res, 200, {
            id: resolvedId,
            caseNumber: details.caseNumber,
            documents: details.documents.length,
            chunksAdded: chunks,
            changes,
            changeLog: catalog.get(resolvedId)?.changeLog?.slice(-10),
          });
          return true;
        }

        case "parser_trigger": {
          if (!scheduler) {
            sendError(res, 503, "Parser scheduler not available");
            return true;
          }
          const { court, daysBack, daysForward } = z.object({
            court: z.string(),
            daysBack: z.number().int().min(0).max(730).optional(),
            daysForward: z.number().int().min(1).max(730).optional(),
          }).parse(body);
          const result = await scheduler.triggerCourt(court, { daysBack, daysForward });
          sendJson(res, 200, result);
          return true;
        }

        case "parser_tier2_trigger": {
          if (!tier2Scheduler) {
            sendError(res, 503, "Tier-2 parser not available");
            return true;
          }
          const { court, deloId, entryDateFrom, entryDateTo } = z.object({
            court: z.string(),
            deloId: z.number().int(),
            entryDateFrom: z.string().optional(),
            entryDateTo: z.string().optional(),
          }).parse(body);
          const filters =
            entryDateFrom && entryDateTo ? { entryDateFrom, entryDateTo } : undefined;
          const result = await tier2Scheduler.triggerSearch(court, deloId, filters);
          sendJson(res, 200, result);
          return true;
        }

        case "parser_enrich": {
          if (!scheduler) {
            sendError(res, 503, "Parser scheduler not available");
            return true;
          }
          const { limit } = z.object({ limit: z.number().int().min(1).max(100).optional() }).parse(body ?? {});
          const result = await scheduler.triggerEnrich(limit ?? 20);
          sendJson(res, 200, result);
          return true;
        }

        case "list_all_cases": {
          if (!catalog) {
            sendError(res, 503, "Case catalog not available");
            return true;
          }
          const result = catalog.list({ limit: 500 });
          sendJson(res, 200, {
            total: result.total,
            cases: result.cases,
          });
          return true;
        }

        case "search_participant": {
          const input = ParticipantSearchSchema.parse(body);
          const base = buildParticipantDossier(input, catalog, rag);
          const dossier: Record<string, unknown> = {
            query: base.query,
            summary: base.summary,
            courts: base.courts,
            local: base.local,
            limits: base.limits,
          };
          if (input.deepSearch && participantJobs) {
            const job = startParticipantDeepSearch(participantJobs, client, input, base.courtsResolved);
            dossier.deepSearch = {
              jobId: job.id,
              status: job.status,
              message: `Фоновый поиск запущен (${job.progress.total} запросов).`,
              pollWith: "get_participant_search",
            };
          }
          sendJson(res, 200, dossier);
          return true;
        }

        case "get_participant_search": {
          if (!participantJobs) {
            sendError(res, 503, "Participant search not available");
            return true;
          }
          const { jobId } = ParticipantJobSchema.parse(body);
          const job = participantJobs.get(jobId);
          if (!job) {
            sendError(res, 404, "job not found");
            return true;
          }
          sendJson(res, 200, formatParticipantSearchJob(job));
          return true;
        }

        case "list_lawyers": {
          if (!catalog) {
            sendError(res, 503, "Case catalog not available");
            return true;
          }
          const input = ListLawyersSchema.parse(body ?? {});
          sendJson(res, 200, await runListLawyers(catalog, input));
          return true;
        }

        case "get_lawyer_card": {
          if (!catalog) {
            sendError(res, 503, "Case catalog not available");
            return true;
          }
          const input = GetLawyerCardSchema.parse(body ?? {});
          const result = await runGetLawyerCard(catalog, input);
          if (!result.lawyer) {
            sendError(res, result.indexReady ? 404 : 503, result.indexReady ? "not found" : "index building");
            return true;
          }
          sendJson(res, 200, result);
          return true;
        }

        case "get_participant_dossier": {
          if (!catalog) {
            sendError(res, 503, "Case catalog not available");
            return true;
          }
          const input = GetParticipantDossierSchema.parse(body ?? {});
          const result = runGetParticipantDossier(catalog, input);
          if (!result.dossier) {
            sendError(res, 404, "not found");
            return true;
          }
          sendJson(res, 200, result);
          return true;
        }

        case "get_mordovia_analytics": {
          if (!catalog) {
            sendError(res, 503, "Case catalog not available");
            return true;
          }
          sendJson(res, 200, compactMordoviaAnalytics(catalog));
          return true;
        }

        case "get_representatives_summary": {
          if (!catalog) {
            sendError(res, 503, "Case catalog not available");
            return true;
          }
          const input = GetRepresentativesSummarySchema.parse(body ?? {});
          sendJson(res, 200, runRepresentativesSummary(catalog, input));
          return true;
        }


        default:
          break;
      }
    }

    // Route not found
    sendError(res, 404, `Unknown endpoint: ${path}`);
    return true;

  } catch (e) {
    if (e instanceof z.ZodError) {
      sendError(res, 400, `Validation error: ${e.errors.map(err => `${err.path.join(".")}: ${err.message}`).join(", ")}`);
      return true;
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[sudrf-rest] Error handling ${path}:`, msg);
    sendError(res, 500, msg);
    return true;
  }
}
