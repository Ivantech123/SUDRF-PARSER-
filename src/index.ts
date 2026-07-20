#!/usr/bin/env node
import { loadDotEnv } from "./ai/load-env.js";
loadDotEnv();

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Prefer cwd (matches CLI scripts / README); fall back next to this module (dist/). */
function defaultDataPath(filename: string): string {
  const cwdPath = join(process.cwd(), filename);
  if (existsSync(cwdPath)) return cwdPath;
  return fileURLToPath(new URL(`./${filename}`, import.meta.url));
}
import { SudrfClient } from "./sudrf/index.js";
import { RagIndex } from "./rag/index.js";
import { AuthStore } from "./auth/store.js";
import { handleApiRoute } from "./auth/api.js";
import { OAuthStore, ACCESS_TOKEN_PREFIX } from "./auth/oauth.js";
import { handleOAuthRoute } from "./auth/oauth-routes.js";
import { handleRestApiRoute } from "./api/routes.js";
import { serializeParserStats } from "./parser/stats-view.js";
import { computeCoverage } from "./analytics/coverage.js";
import { DISPLAY_REGION, isDisplayRegionScoped } from "./config/display-scope.js";
import { resolveEntity } from "./entities/index.js";
import {
  CatalogListSchema,
  SearchCollectedSchema,
  CatalogDocumentSchema,
  listCatalogCases,
  searchCollectedCatalog,
  getCatalogDocument,
} from "./catalog/tools.js";
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
} from "./catalog/agent-tools.js";
import { CaseParserScheduler } from "./parser/scheduler.js";
import { Tier2ParserScheduler, ALL_YEARS_ENTRY_FROM, ALL_YEARS_ENTRY_TO } from "./parser/tier2-scheduler.js";
import { CaseCatalog } from "./cases/store.js";
import { ParticipantSearchJobStore } from "./participant/jobs.js";
import { warmLawyerIndex } from "./lawyers/aggregate.js";
import {
  buildParticipantDossier,
  startParticipantDeepSearch,
  formatParticipantSearchJob,
} from "./participant/dossier.js";

// ── Tool input schemas ───────────────────────────────────────────────────
const HearingScheduleSchema = z.object({
  court: z.string().describe("Court subdomain (as on sudrf.ru) or name/region."),
  date: z.string().describe("Hearing date as DD.MM.YYYY."),
});

const SearchCasesSchema = z.object({
  court: z.string().describe("Court subdomain or name/region."),
  delo_id: z.number().describe("Case category id from list_case_categories (e.g. 4 = criminal, 5 = civil, 1540006 = administrative)."),
  caseNumber: z.string().optional().describe("Case number, e.g. '2-1234/2024'."),
  uid: z.string().optional().describe("Case UID (УИД), format XXWWXXXX-XX-XXXX-XXXXXX-XX."),
  participantName: z.string().optional().describe("Participant/defendant name (ФИО or organization)."),
  inn: z.string().optional(),
  kpp: z.string().optional(),
  ogrn: z.string().optional(),
  judge: z.string().optional().describe("Judge ФИО."),
  entryDateFrom: z.string().optional().describe("DD.MM.YYYY"),
  entryDateTo: z.string().optional().describe("DD.MM.YYYY"),
  resultDateFrom: z.string().optional().describe("DD.MM.YYYY"),
  resultDateTo: z.string().optional().describe("DD.MM.YYYY"),
  lawArticle: z.string().optional().describe("Law article (criminal/admin cases)."),
});

const ResolveCourtSchema = z.object({
  query: z.string().describe("Subdomain, name, or region to resolve to a court."),
});

const CaseDetailsSchema = z.object({
  court: z.string().describe("Court subdomain or name/region (same as search_cases)."),
  caseUrl: z
    .string()
    .describe(
      "Path or full URL of the case card, e.g. '/modules.php?name=sud_delo&name_op=case&case_id=155820227' or the full https://…sudrf.ru URL. Returned in search_cases / get_hearing_schedule results as caseUrl."
    ),
  includeDocumentText: z
    .boolean()
    .optional()
    .describe(
      "If true (default), include the full text of each published judicial act in the result. Set false to get just metadata (titles/dates) when you only need the case outline — much smaller payload."
    ),
});

const NoInputSchema = z.object({});

// ── RAG schemas ──────────────────────────────────────────────────────────
const IndexCaseSchema = z.object({
  court: z.string().describe("Court subdomain or name/region (same as search_cases / get_case_details)."),
  caseUrl: z
    .string()
    .describe(
      "caseUrl of the case to index (as returned by search_cases / get_hearing_schedule). The case card is fetched and its published judicial acts are chunked and added to the searchable corpus."
    ),
  replace: z
    .boolean()
    .optional()
    .describe(
      "If true, re-index the case even if already in the corpus (replaces its chunks). Default false — a second index_case on the same case is a no-op."
    ),
});

const SearchCaseTextsSchema = z.object({
  query: z
    .string()
    .describe(
      "Natural-language or keyword query in Russian, e.g. 'срок исковой давности по кредитному договору' or 'взыскание задолженности по расписке'. Matched against the full text of indexed judicial acts."
    ),
  limit: z
    .number()
    .optional()
    .describe("Max chunks to return (default 10). Each chunk is a passage ~1200 chars from an act."),
  court: z
    .string()
    .optional()
    .describe("Optional filter: restrict hits to one court (subdomain/name/region)."),
  caseNumber: z
    .string()
    .optional()
    .describe("Optional filter: restrict hits to one case number (e.g. '11-90/2024')."),
});

const RemoveCaseSchema = z.object({
  caseUid: z
    .string()
    .describe(
      "УИД (caseUid) of the case to remove from the corpus. Find it in search_case_texts hits or get_case_details."
    ),
});

const ParticipantSearchSchema = z.object({
  name: z.string().describe("ФИО или наименование участника/юриста, напр. «Наумов Сергей Геннадьевич»."),
  region: z
    .string()
    .optional()
    .describe("Подсказка региона/города для выбора судов."),
  courts: z
    .array(z.string())
    .optional()
    .describe("Явный список subdomain судов (перекрывает region)."),
  deepSearch: z
    .boolean()
    .optional()
    .describe(
      "Если true — запускает фоновый Tier-2 поиск по sudrf.ru (капча, медленно). Вернёт jobId; опрашивайте get_participant_search."
    ),
  maxCourts: z.number().optional().describe("Сколько судов обойти при deepSearch (default 5)."),
  deloIds: z
    .array(z.number())
    .optional()
    .describe("Категории delo_id для deepSearch (default: 5 гражданские, 4 уголовные, 41 апелляция)."),
});

const ParticipantJobSchema = z.object({
  jobId: z.string().describe("ID задачи из search_participant (deepSearch=true)."),
});

// ── Server setup ─────────────────────────────────────────────────────────
const client = new SudrfClient({
  headless: process.env.SUDRF_HEADLESS === "0" ? false : true,
  twoCaptchaKey: process.env.TWOCAPTCHA_KEY,
});

// RAG corpus: persisted to disk, loaded once at startup, saved after each
// mutation. Path via SUDRF_RAG_PATH (default ./rag-index.json next to dist/).
const ragPath = process.env.SUDRF_RAG_PATH
  ?? defaultDataPath("rag-index.json");
const rag = new RagIndex();
if (existsSync(ragPath)) {
  try { rag.load(ragPath); } catch (e) {
    console.error(`[sudrf-mcp] WARN: failed to load RAG index at ${ragPath}: ${(e as Error).message}`);
  }
}
/** Debounced RAG persist — full rewrite is expensive at 50k+ chunks. */
const RAG_SAVE_DEBOUNCE_MS = Math.max(0, Number(process.env.RAG_SAVE_DEBOUNCE_MS ?? 8000));
let ragSaveTimer: ReturnType<typeof setTimeout> | null = null;

function flushRagNow(): void {
  if (ragSaveTimer) {
    clearTimeout(ragSaveTimer);
    ragSaveTimer = null;
  }
  if (!rag.isDirty) return;
  try {
    rag.save(ragPath);
  } catch (e) {
    console.error(`[sudrf-mcp] WARN: failed to save RAG index to ${ragPath}: ${(e as Error).message}`);
  }
}

function saveRag(immediate = false): void {
  rag.markDirty();
  if (immediate || RAG_SAVE_DEBOUNCE_MS === 0) {
    flushRagNow();
    return;
  }
  if (ragSaveTimer) return;
  ragSaveTimer = setTimeout(() => {
    ragSaveTimer = null;
    flushRagNow();
  }, RAG_SAVE_DEBOUNCE_MS);
}

// Case catalog for the web UI (metadata-rich cards, separate from RAG).
const casesPath = process.env.SUDRF_CASES_PATH
  ?? defaultDataPath("cases-store.json");
const catalog = new CaseCatalog();
if (existsSync(casesPath)) {
  try { catalog.load(casesPath); } catch (e) {
    console.error(`[sudrf-mcp] WARN: failed to load case catalog at ${casesPath}: ${(e as Error).message}`);
  }
} else {
  catalog.setPath(casesPath);
}
if (catalog.size > 0) {
  warmLawyerIndex(catalog);
}

const participantJobs = new ParticipantSearchJobStore();

// Auth store: users, per-user MCP keys, sessions. Persisted to disk the same
// way as the RAG index. Path via SUDRF_AUTH_PATH (default ./auth-store.json
// next to dist/). In stdio mode it's still loaded so the admin CLI can share
// the file, but the /api routes aren't served.
const authPath = process.env.SUDRF_AUTH_PATH
  ?? defaultDataPath("auth-store.json");
const auth = new AuthStore();
if (existsSync(authPath)) {
  try { auth.load(authPath); } catch (e) {
    console.error(`[sudrf-mcp] WARN: failed to load auth store at ${authPath}: ${(e as Error).message}`);
  }
} else {
  auth.setPath(authPath);
}
// Early-access: make the first two accounts admins so they see waitlist applications.
{
  const promoted = auth.ensureBootstrapAdmins(2);
  if (promoted.length) {
    console.log(`[sudrf-mcp] bootstrap admins: ${promoted.join(", ")}`);
  }
}

// OAuth store: registered clients, auth codes, access/refresh tokens. Backs
// the /authorize, /oauth/token, /register endpoints so Claude can connect to
// /mcp via a standard OAuth flow (static bearer tokens in URLs are rejected
// by the MCP auth spec). Same on-disk JSON pattern as the auth store.
const oauthPath = process.env.SUDRF_OAUTH_PATH
  ?? defaultDataPath("oauth-store.json");
const oauth = new OAuthStore();
if (existsSync(oauthPath)) {
  try { oauth.load(oauthPath); } catch (e) {
    console.error(`[sudrf-mcp] WARN: failed to load oauth store at ${oauthPath}: ${(e as Error).message}`);
  }
} else {
  oauth.setPath(oauthPath);
}

// MCP server factory. In stateless Streamable HTTP mode a fresh Server must be
// used per request — the SDK's Protocol.connect() throws "Already connected to
// a transport" if a single shared Server is connect()ed again before close()
// fully resets _transport, which races under concurrent requests (Claude Code
// fires initialize + tools/list back-to-back). Stdio mode calls this once and
// keeps the instance; http mode calls it per request.
function createMcpServer(): Server {
  return new Server(
    { name: "sudrf-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );
}

const TOOLS = [
  {
    name: "list_case_categories",
    description:
      "List the case-category codes (delo_id) understood by the sudrf search: criminal, civil, administrative, appeal, cassation, etc. Call this first to pick the right delo_id for search_cases.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "resolve_court",
    description:
      "Resolve a court name/region/subdomain query to sudrf.ru subdomains. Returns best match plus ranked candidates (up to 8). Prefer `best.subdomain` as the `court` argument to other tools. If `ambiguous` is true, ask the user to pick from `candidates`.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "get_hearing_schedule",
    description:
      "Tier 1 (no captcha, fast): list cases scheduled for a hearing on a given date at a court. Returns case numbers, parties, judge, courtroom, time. Best for daily monitoring of a court's docket.",
    inputSchema: {
      type: "object",
      properties: {
        court: { type: "string" },
        date: { type: "string" },
      },
      required: ["court", "date"],
    },
  },
  {
    name: "search_cases",
    description:
      "Tier 2 (captcha-gated, slower): extended search of court cases by number, UID, participant name, INN/OGRN, judge, dates, or law article. Requires a delo_id category (see list_case_categories). Drives a real browser and solves the captcha automatically.",
    inputSchema: {
      type: "object",
      properties: {
        court: { type: "string" },
        delo_id: { type: "number" },
        caseNumber: { type: "string" },
        uid: { type: "string" },
        participantName: { type: "string" },
        inn: { type: "string" },
        kpp: { type: "string" },
        ogrn: { type: "string" },
        judge: { type: "string" },
        entryDateFrom: { type: "string" },
        entryDateTo: { type: "string" },
        resultDateFrom: { type: "string" },
        resultDateTo: { type: "string" },
        lawArticle: { type: "string" },
      },
      required: ["court", "delo_id"],
    },
  },
  {
    name: "get_case_details",
    description:
      "Fetch the full case detail card (карточка дела) for one case: participants, case timeline (events), first-instance info, and the full text of every published judicial act (решение/определение/приговор). No captcha — fast plain HTTP with a browser fallback. Pass the caseUrl returned by search_cases or get_hearing_schedule. Set includeDocumentText=false to receive only act metadata (titles/dates) without the full text.",
    inputSchema: {
      type: "object",
      properties: {
        court: { type: "string" },
        caseUrl: { type: "string" },
        includeDocumentText: { type: "boolean" },
      },
      required: ["court", "caseUrl"],
    },
  },
  {
    name: "index_case",
    description:
      "Fetch a case card and add its judicial acts to the local searchable corpus (RAG index) so you can later run search_case_texts over it. Use after get_case_details when a case's acts are worth keeping for cross-case research. Returns the number of text chunks added. Idempotent — re-indexing an already-indexed case is a no-op unless replace=true. The corpus persists on disk across server restarts.",
    inputSchema: {
      type: "object",
      properties: {
        court: { type: "string" },
        caseUrl: { type: "string" },
        replace: { type: "boolean" },
      },
      required: ["court", "caseUrl"],
    },
  },
  {
    name: "search_case_texts",
    description:
      "Search the indexed corpus of judicial act texts by keyword/phrase (Russian). Returns ranked passages (BM25) with the source case number, court, act type, date, and the matching text fragment — enough to cite the source. Use for cross-case research: 'как суды применяют срок исковой давности по кредитным договорам', 'взыскание долга по расписке', 'отмена судебного приказа'. Index cases first with index_case. Optionally filter by court or case number.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
        court: { type: "string" },
        caseNumber: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_indexed_cases",
    description:
      "List the cases currently in the RAG corpus (caseUid, caseNumber, court, chunk count). Use to see what's indexed before searching, or to find a caseUid for remove_case.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "remove_case",
    description:
      "Remove one case and all its text chunks from the RAG corpus (by caseUid). Use to prune cases no longer needed. Find the caseUid via list_indexed_cases or search_case_texts hits.",
    inputSchema: {
      type: "object",
      properties: { caseUid: { type: "string" } },
      required: ["caseUid"],
    },
  },
  {
    name: "search_participant",
    description:
      "Поиск участника/юриста: сначала в локальном каталоге и RAG (быстро). deepSearch=true — фоновый Tier-2 по sudrf.ru. Для общего поиска по собранному — search_collected.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        region: { type: "string" },
        courts: { type: "array", items: { type: "string" } },
        deepSearch: { type: "boolean" },
        maxCourts: { type: "number" },
        deloIds: { type: "array", items: { type: "number" } },
      },
      required: ["name"],
    },
  },
  {
    name: "get_participant_search",
    description:
      "Статус и результаты фонового поиска участника (search_participant с deepSearch=true). Пока status=running — опрашивайте снова через 15–30 сек.",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string" } },
      required: ["jobId"],
    },
  },
  {
    name: "parser_stats",
    description:
      "Статистика автопарсера Tier-1 (расписания) и Tier-2 (расширенный поиск): catalogSize, enrichPending, tier2.courtsTotal. Мониторинг сбора.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "parser_trigger",
    description: "Вручную запустить сбор дел по расписанию заседаний для одного суда (subdomain или название).",
    inputSchema: {
      type: "object",
      properties: {
        court: { type: "string" },
        daysBack: { type: "number", description: "Сколько дней назад от сегодня (переопределяет PARSER_SCHEDULE_DAYS_BACK)" },
        daysForward: { type: "number", description: "Сколько дней вперёд включая сегодня (переопределяет PARSER_SCHEDULE_DAYS)" },
      },
      required: ["court"],
    },
  },
  {
    name: "parser_tier2_trigger",
    description:
      "Tier-2 расширенный поиск (Playwright + капча) по дате поступления. Для всех лет: entryDateFrom=01.01.2000, entryDateTo=31.12.2030 (на сервере режется по месяцам). delo_id: 5=гражд., 4=уголов., 41=апелляция.",
    inputSchema: {
      type: "object",
      properties: {
        court: { type: "string", description: "subdomain суда (как в URL *.sudrf.ru)" },
        deloId: { type: "number", description: "Категория дела (5, 4, 41…)" },
        entryDateFrom: { type: "string", description: "DD.MM.YYYY" },
        entryDateTo: { type: "string", description: "DD.MM.YYYY" },
      },
      required: ["court", "deloId"],
    },
  },
  {
    name: "parser_enrich",
    description:
      "Подтянуть карточки дел и тексты судебных актов для необогащённых записей каталога (до limit штук).",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number" } },
      required: [],
    },
  },
  {
    name: "list_catalog_cases",
    description:
      "Список дел из локального каталога парсера (Tier-1/Tier-2). Метаданные: номер, суд, участники, судья, статус. Фильтры: q, court, region, participant, judge, category, hasDocuments, enriched, hearingFrom, hearingTo. Для полного текста актов — search_collected или get_catalog_document.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Поиск по номеру, УИД, ФИО, суду, категории" },
        court: { type: "string", description: "subdomain суда (как в URL *.sudrf.ru)" },
        region: { type: "string", description: "Код региона из list_catalog_regions" },
        caseNumber: { type: "string" },
        uid: { type: "string" },
        participant: { type: "string" },
        judge: { type: "string" },
        category: { type: "string" },
        hasDocuments: { type: "boolean" },
        enriched: { type: "boolean", description: "true — только с полной карточкой" },
        hearingFrom: { type: "string", description: "Дата заседания с (YYYY-MM-DD или DD.MM.YYYY)" },

        hearingTo: { type: "string", description: "Дата заседания по (YYYY-MM-DD или DD.MM.YYYY)" },

        limit: { type: "number" },
        offset: { type: "number" },
      },
      required: [],
    },
  },
  {
    name: "resolve_entity",
    description:
      "Нормализация и поиск юридических лиц в каталоге: ООО «Ромашка» / ООО Ромашка → единая сущность + список дел. Для ФИО физлиц — search_participant.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Наименование организации" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "catalog_coverage",
    description:
      "Аналитика качества собранных данных: воронка карточек → обогащение → документы → полный текст → RAG. Разбивка по судам.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "case_search",
    description:
      "Поиск дел в каталоге: метаданные + полнотекст судебных актов (RAG). Для живого поиска на sudrf.ru — search_cases.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Поисковый запрос (ФИО, номер дела, тема)" },
        limit: { type: "number" },
        region: { type: "string", description: "Код региона, напр. 13" },
        court: { type: "string", description: "subdomain суда" },
        caseNumber: { type: "string" },
        participant: { type: "string" },
        judge: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_collected",
    description:
      "Единый поиск по всему собранному: локальный каталог парсера (метаданные дел) + RAG-индекс (полнотекст судебных актов). Используйте первым для вопросов «что мы уже нашли» — без запросов на sudrf.ru.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
        region: { type: "string" },
        court: { type: "string" },
        caseNumber: { type: "string" },
        participant: { type: "string" },
        judge: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_catalog_courts",
    description: "Суды, представленные в каталоге парсера, с количеством дел.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_catalog_regions",
    description: "Регионы, представленные в каталоге.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_catalog_categories",
    description: "Категории дел в каталоге с количеством.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_all_cases",
    description:
      "Быстрый срез каталога (до 500 дел). Для фильтров используйте list_catalog_cases.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number" } },
      required: [],
    },
  },
  {
    name: "get_catalog_document",
    description:
      "Полный текст судебного акта из собранного каталога (catalog → sudrf → RAG). caseId из list_catalog_cases / get_catalog_case, docId из documents[].",
    inputSchema: {
      type: "object",
      properties: {
        caseId: { type: "string" },
        docId: { type: "string" },
      },
      required: ["caseId", "docId"],
    },
  },
  {
    name: "get_catalog_case",
    description: "Полная карточка дела из каталога по id (участники, события, документы, changeLog).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "sync_catalog_case",
    description:
      "Обновить дело из sudrf.ru: скачать карточку, сравнить изменения (статус, судья, новые документы), обновить каталог и RAG.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        court: { type: "string" },
        caseUrl: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "list_lawyers",
    description:
      "Список карточек юристов и судей из каталога (рейтинг, суды, категории). Фильтры: q, role=lawyer|judge.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Поиск по ФИО, суду, категории" },
        role: { type: "string", description: "lawyer или judge" },
        limit: { type: "number" },
        offset: { type: "number" },
      },
      required: [],
    },
  },
  {
    name: "get_lawyer_card",
    description:
      "Полная карточка юриста или судьи по id или ФИО: статистика, география, практика, недавние дела.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "id карточки из list_lawyers" },
        name: { type: "string", description: "ФИО (частичное совпадение допустимо)" },
      },
      required: [],
    },
  },
  {
    name: "get_participant_dossier",
    description:
      "Каталожное досье участника (истец/ответчик/представитель/…): статистика, исходы, суды, список дел. Не путать с live search_participant (sudrf).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "id из каталога участников" },
        name: { type: "string", description: "ФИО / наименование" },
        role: { type: "string", description: "Фильтр роли: representative, plaintiff, defendant, all" },
        caseLimit: { type: "number", description: "Макс. дел в ответе (default 80)" },
      },
      required: [],
    },
  },
  {
    name: "get_mordovia_analytics",
    description:
      "Сводка по каталогу: totals, outcomes, heatmap судов, top категории/судьи, professionals, participants. Для матрицы представителей — get_representatives_summary.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_representatives_summary",
    description:
      "Сводка по представителям / адвокатам / юристам: плотность по судам, топ ФИО, матрица people×courts.",
    inputSchema: {
      type: "object",
      properties: {
        topPeople: { type: "number", description: "Сколько топ-участников в матрице (5–40, default 18)" },
      },
      required: [],
    },
  },

];

// Register request handlers on a Server instance. Called once for the stdio
// server and once per request for the stateless http server.
function registerHandlers(srv: Server): void {
  srv.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  srv.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    switch (name) {
      case "list_case_categories": {
        NoInputSchema.parse(args ?? {});
        const cats = client.listCategories();
        return { content: [{ type: "text", text: JSON.stringify(cats, null, 2) }] };
      }
      case "resolve_court": {
        const { query } = ResolveCourtSchema.parse(args ?? {});
        const result = client.resolveCourtWithCandidates(query);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "get_hearing_schedule": {
        const { court, date } = HearingScheduleSchema.parse(args ?? {});
        const schedule = await client.getHearingSchedule(court, date);
        return { content: [{ type: "text", text: JSON.stringify(schedule, null, 2) }] };
      }
      case "search_cases": {
        const input = SearchCasesSchema.parse(args ?? {});
        const { court, delo_id, ...filters } = input;
        const results = await client.searchCases(court, delo_id, filters);
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }
      case "get_case_details": {
        const { court, caseUrl, includeDocumentText } = CaseDetailsSchema.parse(args ?? {});
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
          return { content: [{ type: "text", text: JSON.stringify(stripped, null, 2) }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(details, null, 2) }] };
      }
      case "index_case": {
        const { court, caseUrl, replace } = IndexCaseSchema.parse(args ?? {});
        const details = await client.getCaseDetails(court, caseUrl);
        const uid = details.caseUid ?? details.caseNumber ?? caseUrl;
        const added = rag.addCase(details, replace);
        if (added > 0) saveRag();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              caseUid: uid || undefined,
              caseNumber: details.caseNumber || undefined,
              court: details.court,
              chunksAdded: added,
              alreadyIndexed: added === 0 && rag.hasCase(uid),
              corpusSize: rag.size,
              corpusCases: rag.caseCount,
            }, null, 2),
          }],
        };
      }
      case "search_case_texts": {
        const { query, limit, court, caseNumber } = SearchCaseTextsSchema.parse(args ?? {});
        const res = rag.search(query, limit ?? 10);
        // optional post-filters by court / caseNumber (substring match on the
        // denormalized chunk fields — cheap and avoids a second index)
        let hits = res.hits;
        if (court) {
          const c = client.resolveCourt(court);
          hits = hits.filter(h => h.chunk.court === c.name || h.chunk.court?.includes(court));
        }
        if (caseNumber) {
          hits = hits.filter(h => h.chunk.caseNumber === caseNumber);
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              query: res.query,
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
            }, null, 2),
          }],
        };
      }
      case "list_indexed_cases": {
        NoInputSchema.parse(args ?? {});
        const cases = rag.listCases();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ corpusSize: rag.size, caseCount: rag.caseCount, cases }, null, 2),
          }],
        };
      }
      case "remove_case": {
        const { caseUid } = RemoveCaseSchema.parse(args ?? {});
        const removed = rag.removeCase(caseUid);
        if (removed > 0) saveRag();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ caseUid, chunksRemoved: removed, corpusSize: rag.size, corpusCases: rag.caseCount }, null, 2),
          }],
        };
      }
      case "search_participant": {
        const input = ParticipantSearchSchema.parse(args ?? {});
        const base = buildParticipantDossier(input, catalog, rag);
        const dossier: Record<string, unknown> = {
          query: base.query,
          summary: base.summary,
          courts: base.courts,
          local: base.local,
          limits: base.limits,
        };
        if (input.deepSearch) {
          const job = startParticipantDeepSearch(participantJobs, client, input, base.courtsResolved);
          dossier.deepSearch = {
            jobId: job.id,
            status: job.status,
            message: `Фоновый поиск запущен: ${job.progress.total} запросов (${job.courts.length} судов × ${job.deloIds.length} категорий). Опрашивайте get_participant_search.`,
            pollWith: "get_participant_search",
          };
        }
        return { content: [{ type: "text", text: JSON.stringify(dossier, null, 2) }] };
      }
      case "get_participant_search": {
        const { jobId } = ParticipantJobSchema.parse(args ?? {});
        const job = participantJobs.get(jobId);
        if (!job) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "job not found", jobId }, null, 2) }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify(formatParticipantSearchJob(job), null, 2) }] };
      }
      case "resolve_entity": {
        const { query, limit } = z.object({
          query: z.string().min(1),
          limit: z.number().int().min(1).max(50).optional(),
        }).parse(args ?? {});
        if (!catalog) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "catalog not available" }, null, 2) }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify(resolveEntity(catalog, query, limit ?? 20), null, 2) }] };
      }
      case "catalog_coverage": {
        NoInputSchema.parse(args ?? {});
        if (!catalog) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "catalog not available" }, null, 2) }], isError: true };
        }
        const scope = isDisplayRegionScoped() ? DISPLAY_REGION : undefined;
        return { content: [{ type: "text", text: JSON.stringify(computeCoverage(catalog, rag, { region: scope }), null, 2) }] };
      }
      case "parser_stats": {
        NoInputSchema.parse(args ?? {});
        if (!scheduler) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "parser not available" }, null, 2) }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify(serializeParserStats(scheduler.getStats(), tier2Scheduler?.getStats()), null, 2) }] };
      }
      case "parser_trigger": {
        const { court, daysBack, daysForward } = z.object({
          court: z.string(),
          daysBack: z.number().int().min(0).max(365).optional(),
          daysForward: z.number().int().min(1).max(365).optional(),
        }).parse(args ?? {});
        if (!scheduler) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "parser not available" }, null, 2) }], isError: true };
        }
        const result = await scheduler.triggerCourt(court, { daysBack, daysForward });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "parser_tier2_trigger": {
        const { court, deloId, entryDateFrom, entryDateTo } = z.object({
          court: z.string(),
          deloId: z.number().int(),
          entryDateFrom: z.string().optional(),
          entryDateTo: z.string().optional(),
        }).parse(args ?? {});
        if (!tier2Scheduler) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "tier2 parser not available" }, null, 2) }], isError: true };
        }
        const filters = entryDateFrom && entryDateTo ? { entryDateFrom, entryDateTo } : undefined;
        const result = await tier2Scheduler.triggerSearch(court, deloId, filters);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "parser_enrich": {
        const { limit } = z.object({ limit: z.number().int().min(1).max(100).optional() }).parse(args ?? {});
        if (!scheduler) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "parser not available" }, null, 2) }], isError: true };
        }
        const result = await scheduler.triggerEnrich(limit ?? 20);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "list_catalog_cases": {
        const input = CatalogListSchema.parse(args ?? {});
        const result = listCatalogCases(catalog, input);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "case_search":
      case "search_collected": {
        const input = SearchCollectedSchema.parse(args ?? {});
        const result = searchCollectedCatalog(catalog, rag, input);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "list_catalog_courts": {
        NoInputSchema.parse(args ?? {});
        const courts = catalog.courts().filter(
          (c) => !isDisplayRegionScoped() || c.region === DISPLAY_REGION,
        );
        return { content: [{ type: "text", text: JSON.stringify({ courts }, null, 2) }] };
      }
      case "list_catalog_regions": {
        NoInputSchema.parse(args ?? {});
        const regions = catalog.regions().filter(
          (r) => !isDisplayRegionScoped() || r.region === DISPLAY_REGION,
        );
        return { content: [{ type: "text", text: JSON.stringify({ regions }, null, 2) }] };
      }
      case "list_catalog_categories": {
        NoInputSchema.parse(args ?? {});
        return { content: [{ type: "text", text: JSON.stringify({ categories: catalog.categoryFacets() }, null, 2) }] };
      }
      case "list_all_cases": {
        const { limit } = z.object({ limit: z.number().int().min(1).max(500).optional() }).parse(args ?? {});
        const result = listCatalogCases(catalog, { limit: limit ?? 500, offset: 0 });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "get_catalog_document": {
        const { caseId, docId } = CatalogDocumentSchema.parse(args ?? {});
        try {
          const doc = await getCatalogDocument(catalog, rag, client, caseId, docId);
          return { content: [{ type: "text", text: JSON.stringify(doc, null, 2) }] };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { content: [{ type: "text", text: JSON.stringify({ error: msg, caseId, docId }, null, 2) }], isError: true };
        }
      }
      case "get_catalog_case": {
        const { id } = z.object({ id: z.string() }).parse(args ?? {});
        const c = catalog.get(id);
        if (!c) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "not found", id }, null, 2) }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify({ case: c }, null, 2) }] };
      }
      case "sync_catalog_case": {
        const input = z.object({
          id: z.string().optional(),
          court: z.string().optional(),
          caseUrl: z.string().optional(),
        }).parse(args ?? {});
        let subdomain = input.court;
        let caseUrl = input.caseUrl;
        let id = input.id;
        if (id) {
          const existing = catalog.get(id);
          if (!existing) {
            return { content: [{ type: "text", text: JSON.stringify({ error: "not found", id }, null, 2) }], isError: true };
          }
          subdomain = existing.courtSubdomain;
          caseUrl = existing.caseUrl;
          if (!caseUrl) {
            return { content: [{ type: "text", text: JSON.stringify({ error: "case has no caseUrl", id }, null, 2) }], isError: true };
          }
        }
        if (!subdomain || !caseUrl) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "id or (court + caseUrl) required" }, null, 2) }], isError: true };
        }
        const details = await client.getCaseDetails(subdomain, caseUrl);
        const resolvedId = id ?? (details.caseUid ?? `${subdomain}:${details.caseNumber}`);
        const chunks = rag.addCase(details, true);
        const changes = catalog.enrichFromDetails(resolvedId, details, chunks > 0);
        if (chunks > 0) saveRag();
        catalog.flush();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              id: resolvedId,
              caseNumber: details.caseNumber,
              documents: details.documents.length,
              chunksAdded: chunks,
              changes,
              changeLog: catalog.get(resolvedId)?.changeLog?.slice(-10),
            }, null, 2),
          }],
        };
      }
      case "list_lawyers": {
        const input = ListLawyersSchema.parse(args ?? {});
        const result = await runListLawyers(catalog, input);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "get_lawyer_card": {
        const input = GetLawyerCardSchema.parse(args ?? {});
        const result = await runGetLawyerCard(catalog, input);
        if (!result.lawyer) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: result.indexReady ? "not found" : "index building", ...result }, null, 2) }],
            isError: true,
          };
        }
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "get_participant_dossier": {
        const input = GetParticipantDossierSchema.parse(args ?? {});
        const result = runGetParticipantDossier(catalog, input);
        if (!result.dossier) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "not found", dossier: null }, null, 2) }],
            isError: true,
          };
        }
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "get_mordovia_analytics": {
        return { content: [{ type: "text", text: JSON.stringify(compactMordoviaAnalytics(catalog), null, 2) }] };
      }
      case "get_representatives_summary": {
        const input = GetRepresentativesSummarySchema.parse(args ?? {});
        const result = runRepresentativesSummary(catalog, input);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
  }
  });
}

// stdio mode keeps a single long-lived server; http mode builds one per request
// (see createMcpServer/registerHandlers above).
const server = createMcpServer();
registerHandlers(server);

// ── Boot ─────────────────────────────────────────────────────────────────
// Transport selection:
//   MCP_TRANSPORT=stdio (default) — for local Claude Code / Desktop over stdin.
//   MCP_TRANSPORT=http            — for remote/VPS deployment; listens on
//                                    MCP_PORT (default 8080). /mcp auth is
//                                    OAuth 2.0 (auth-code + PKCE, RFC 7591 DCR)
//                                    so Claude can connect natively; legacy
//                                    cabinet bearer keys still work. The web
//                                    cabinet uses /api/* (cookie session).
const transportMode = process.env.MCP_TRANSPORT ?? "stdio";

// Auto-parser: Tier-1 schedules can run in Go parser-worker (PARSER_WORKER_URL).
const parserWorkerURL = process.env.PARSER_WORKER_URL?.trim();
// AUTO_PARSER=0 disables even in http mode (needed when vacuum/enrich owns the catalog).
const autoParserEnabled =
  process.env.AUTO_PARSER === "1"
  || (transportMode === "http" && process.env.AUTO_PARSER !== "0");
let scheduler: CaseParserScheduler | undefined;
let tier2Scheduler: Tier2ParserScheduler | undefined;

if (parserWorkerURL) {
  console.log(`[sudrf-mcp] Tier-1 parser delegated to Go worker at ${parserWorkerURL}`);
}

// Hot-reload catalog when vacuum/reparse write cases-store.json from another process.
setInterval(() => {
  try {
    if (catalog.reloadIfChanged()) {
      console.log(`[sudrf-mcp] catalog reloaded from disk (size=${catalog.size})`);
      warmLawyerIndex(catalog);
    }
  } catch (e) {
    console.error(`[sudrf-mcp] catalog reload failed: ${(e as Error).message}`);
  }
}, 30_000);

if (autoParserEnabled) {
  const workerEnrich = process.env.PARSER_WORKER_ENRICH === "1";
  scheduler = new CaseParserScheduler(client, catalog, rag, saveRag, {
    scheduleCollection: !parserWorkerURL,
    enrichQueue: !workerEnrich,
    casesPerHour: Number(process.env.PARSER_CASES_PER_HOUR ?? 200),
    courtsConcurrent: Number(process.env.PARSER_CONCURRENT_COURTS ?? 3),
    startDelay: Number(process.env.PARSER_START_DELAY ?? 10000),
    enrichPerCourt: Number(process.env.PARSER_ENRICH_PER_COURT ?? 5),
    enrichQueuePerTick: Number(process.env.PARSER_ENRICH_QUEUE ?? 12),
    tickIntervalMs: Number(process.env.PARSER_TICK_INTERVAL_MS ?? 60_000),
    scheduleDays: Number(process.env.PARSER_SCHEDULE_DAYS ?? 7),
    scheduleDaysBack: Number(process.env.PARSER_SCHEDULE_DAYS_BACK ?? 0),
    enrichDelayMs: Number(process.env.PARSER_ENRICH_DELAY_MS ?? 2000),
    enrichRegion: process.env.PARSER_ENRICH_REGION || process.env.PARSER_REGION || undefined,
    region: process.env.PARSER_REGION || process.env.PARSER_TIER2_REGION || undefined,
    rescheduleMinutes: {
      hit: Number(process.env.PARSER_RESCHEDULE_HIT ?? 10),
      miss: Number(process.env.PARSER_RESCHEDULE_MISS ?? 20),
      error: Number(process.env.PARSER_RESCHEDULE_ERROR ?? 15),
    },
  });

  if (process.env.AUTO_TIER2 === "1") {
    tier2Scheduler = new Tier2ParserScheduler(client, catalog, {
      daysBack: Number(process.env.PARSER_TIER2_DAYS_BACK ?? 60),
      entryDateFrom: process.env.PARSER_TIER2_ENTRY_FROM
        || (process.env.PARSER_TIER2_REGION ? ALL_YEARS_ENTRY_FROM : undefined),
      entryDateTo: process.env.PARSER_TIER2_ENTRY_TO
        || (process.env.PARSER_TIER2_REGION ? ALL_YEARS_ENTRY_TO : undefined),
      region: process.env.PARSER_TIER2_REGION || process.env.PARSER_REGION || undefined,
      courts: process.env.PARSER_TIER2_COURTS?.split(",").map((s) => s.trim()).filter(Boolean),
      startDelay: Number(process.env.PARSER_TIER2_START_DELAY ?? 45_000),
      tickIntervalMs: Number(process.env.PARSER_TIER2_TICK_MS ?? 8000),
      tier2Only: process.env.PARSER_TIER2_ALL !== "1",
    });
  }
}

async function shutdown(): Promise<void> {
  flushRagNow();
  catalog.flush();
  auth.flush();
  oauth.flush();
  if (scheduler) scheduler.stop();
  if (tier2Scheduler) tier2Scheduler.stop();
  await client.close();
  await server.close();
}

if (transportMode === "http") {
  const port = Number(process.env.MCP_PORT ?? 8080);

  // Public MCP endpoint URL advertised to users in the cabinet. Override via
  // MCP_PUBLIC_URL when behind a reverse-proxy/domain
  // (e.g. https://sudrf.example/mcp).
  const mcpEndpoint = process.env.MCP_PUBLIC_URL ?? `http://localhost:${port}/mcp`;

  // Stateless Streamable HTTP: a fresh Server + transport per request, no
  // session id (see createMcpServer/registerHandlers). The single `server`
  // instance below is only used for stdio mode + graceful shutdown.
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "";

    // 0) OAuth authorization-server routes (well-known, register, authorize,
    //    token, revoke). Must come before /api and /mcp. These render the
    //    consent screen and mint tokens that /mcp below accepts.
    if (url.startsWith("/.well-known/") || url.startsWith("/register") || url.startsWith("/authorize") || url.startsWith("/oauth/")) {
      try {
        const handled = await handleOAuthRoute(req, res, oauth, auth);
        if (handled) return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!res.headersSent) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: msg }));
        }
        return;
      }
    }

    // 1) REST API (/rest/*) — bearer-token auth, mirrors MCP tools as HTTP endpoints.
    if (url.startsWith("/rest/")) {
      try {
        const handled = await handleRestApiRoute(req, res, client, rag, auth, oauth, saveRag, scheduler, catalog, participantJobs, tier2Scheduler);
        if (handled) return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: msg }));
        }
        return;
      }
    }

    // 2) Frontend auth API (/api/*) — cookie-session, served before /mcp.
    if (url.startsWith("/api/")) {
      try {
        const handled = await handleApiRoute(req, res, auth, mcpEndpoint, oauth, rag, scheduler, catalog, client, participantJobs, tier2Scheduler, saveRag);
        if (handled) return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!res.headersSent) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: msg }));
        }
        return;
      }
    }

    // 3) MCP endpoint — accept either an OAuth access token (issued via
    //    /authorize + /oauth/token, prefixed oat_) or a legacy cabinet bearer
    //    key (randomToken, 64-char hex). Both are looked up in their stores.
    if (url.startsWith("/mcp")) {
      const authHeader = req.headers["authorization"] ?? "";
      const m = /^Bearer\s+(.+)$/i.exec(authHeader);
      const token = m ? m[1].trim() : "";

      let authedUserId: string | undefined;
      if (token.startsWith(ACCESS_TOKEN_PREFIX)) {
        const tok = oauth.validateAccessToken(token);
        if (tok) authedUserId = tok.userId;
      } else if (token) {
        const key = auth.findKeyByToken(token);
        if (key) authedUserId = key.userId;
      }

      if (!authedUserId) {
        // RFC 9728 §5.1: the WWW-Authenticate challenge parameter is
        // `resource_metadata` (NOT `resource_metadata_url`). Claude Desktop /
        // the MCP SDK parse it via extractFieldFromWwwAuth('resource_metadata')
        // and fail discovery — "Couldn't register with sudrf's sign-in service"
        // — if the name is wrong. The value is the URL of the protected-resource
        // metadata document, which advertises our authorization server.
        // RFC 9728 §3.1: resource at /mcp → metadata at
        // /.well-known/oauth-protected-resource/mcp (not the root path).
        const resourceMeta = `${mcpEndpoint.replace(/\/mcp$/, "")}/.well-known/oauth-protected-resource/mcp`;
        res.writeHead(401, {
          "content-type": "application/json",
          "www-authenticate": `Bearer realm="sudrf-mcp", resource_metadata="${resourceMeta}"`,
        });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      if (req.method !== "POST" && req.method !== "GET" && req.method !== "DELETE") {
        res.writeHead(405, { allow: "POST, GET, DELETE" });
        res.end();
        return;
      }
      // Read+parse body for POST.
      let parsedBody: unknown;
      if (req.method === "POST") {
        const raw = await readBody(req);
        try { parsedBody = JSON.parse(raw); }
        catch { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "invalid JSON" })); return; }
      }
      // Stateless Streamable HTTP: a fresh Server + transport per request, no
      // session id. Building a new Server each request avoids the SDK's
      // "Already connected to a transport" race that a single shared Server
      // hits under concurrent requests (initialize + tools/list back-to-back).
      const httpTransport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const reqServer = createMcpServer();
      registerHandlers(reqServer);
      try {
        await reqServer.connect(httpTransport);
        await httpTransport.handleRequest(req, res, parsedBody);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[sudrf-mcp] request error:", msg);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: msg }));
        }
      } finally {
        await reqServer.close().catch(() => {});
      }
      return;
    }

    // 4) Anything else → 404 (frontend is served by a separate process /
    //    reverse-proxied; the MCP server only owns /mcp, /rest/*, and /api/*).
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  // Bind address: default all interfaces; set MCP_BIND=127.0.0.1 when behind
  // a reverse proxy so the backend is only reachable via the public edge.
  const bind = process.env.MCP_BIND;
  httpServer.listen(port, bind, () => {
    console.log(`[sudrf-mcp] Streamable HTTP on ${bind ?? "*"}:${port}`);
    console.log(`  /mcp         — MCP protocol (OAuth/cabinet key)`);
    console.log(`  /rest/*      — REST API (OAuth/cabinet key)`);
    console.log(`  /api/*       — Cabinet API (session auth)`);
    console.log(`  /authorize   — OAuth authorization`);
    console.log(`  /oauth/token — OAuth token endpoint`);
    
    if (scheduler) {
      console.log(`[sudrf-mcp] Starting automated case parser (Tier-1)...`);
      scheduler.start();
    }
    if (tier2Scheduler) {
      console.log(`[sudrf-mcp] Starting Tier-2 extended search parser...`);
      tier2Scheduler.start();
    }
  });
  const shutdownHttp = async (sig: string): Promise<void> => {
    console.log(`[sudrf-mcp] ${sig} received, shutting down…`);
    auth.flush();
    oauth.flush();
    httpServer.close();
    await shutdown();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdownHttp("SIGINT"));
  process.on("SIGTERM", () => void shutdownHttp("SIGTERM"));
} else {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.on("SIGINT", async () => {
    await shutdown();
    process.exit(0);
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => { data += chunk.toString("utf8"); });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
