// REST API Documentation page — comprehensive guide with examples, endpoint
// reference, and interactive code snippets for all supported languages.

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useAuth } from "../lib/auth.js";
import SegmentTabs, { TabPanel } from "./SegmentTabs.js";

type DocsTab = "start" | "endpoints" | "tiers" | "more";

const DOCS_TABS: Array<{ id: DocsTab; label: string }> = [
  { id: "start", label: "Старт" },
  { id: "endpoints", label: "Endpoints" },
  { id: "tiers", label: "Уровни" },
  { id: "more", label: "Ещё" },
];

type Language = "curl" | "typescript" | "python" | "javascript";
type Endpoint =
  | "list_case_categories"
  | "resolve_court"
  | "get_hearing_schedule"
  | "search_cases"
  | "get_case_details"
  | "index_case"
  | "search_case_texts"
  | "list_indexed_cases"
  | "remove_case";

interface EndpointInfo {
  id: Endpoint;
  name: string;
  method: string;
  path: string;
  tier: string;
  description: string;
  request?: Record<string, { type: string; required: boolean; description: string }>;
  response: string;
}

const ENDPOINTS: EndpointInfo[] = [
  {
    id: "list_case_categories",
    name: "Список категорий дел",
    method: "GET",
    path: "/rest/list_case_categories",
    tier: "–",
    description: "Возвращает все доступные категории дел (delo_id) для использования в search_cases.",
    response: `[
  {
    "id": 4,
    "label": "Уголовные дела",
    "name": "CRIMINAL"
  }
]`,
  },
  {
    id: "resolve_court",
    name: "Разрешение суда",
    method: "POST",
    path: "/rest/resolve_court",
    tier: "–",
    description: "Определяет поддомен суда по названию, региону или vnkod.",
    request: {
      query: { type: "string", required: true, description: "Название, регион или поддомен суда" },
    },
    response: `{
  "subdomain": "vs--mor",
  "name": "Верховный Суд Республики Мордовия",
  "region": "Республика Мордовия",
  "captcha": true,
  "http": true
}`,
  },
  {
    id: "get_hearing_schedule",
    name: "Расписание заседаний",
    method: "POST",
    path: "/rest/get_hearing_schedule",
    tier: "1",
    description: "Получить список дел на заседание на указанную дату (быстро, без капчи).",
    request: {
      court: { type: "string", required: true, description: "Поддомен или название суда" },
      date: { type: "string", required: true, description: "Дата в формате DD.MM.YYYY" },
    },
    response: `{
  "court": "Верховный Суд Республики Мордовия",
  "date": "25.01.2025",
  "count": 15,
  "items": [...]
}`,
  },
  {
    id: "search_cases",
    name: "Расширенный поиск дел",
    method: "POST",
    path: "/rest/search_cases",
    tier: "2",
    description: "Поиск дел по различным критериям (с автоматическим решением капчи).",
    request: {
      court: { type: "string", required: true, description: "Поддомен или название суда" },
      delo_id: { type: "number", required: true, description: "ID категории из list_case_categories" },
      caseNumber: { type: "string", required: false, description: "Номер дела (например, 2-1234/2024)" },
      participantName: { type: "string", required: false, description: "ФИО или название организации" },
      judge: { type: "string", required: false, description: "ФИО судьи" },
      entryDateFrom: { type: "string", required: false, description: "Дата поступления от (DD.MM.YYYY)" },
      entryDateTo: { type: "string", required: false, description: "Дата поступления до (DD.MM.YYYY)" },
    },
    response: `{
  "court": "...",
  "category": "Гражданские дела",
  "total": 3,
  "results": [...]
}`,
  },
  {
    id: "get_case_details",
    name: "Детали дела",
    method: "POST",
    path: "/rest/get_case_details",
    tier: "1",
    description: "Получить полную карточку дела со всеми судебными актами.",
    request: {
      court: { type: "string", required: true, description: "Поддомен или название суда" },
      caseUrl: { type: "string", required: true, description: "URL карточки дела из search_cases" },
      includeDocumentText: { type: "boolean", required: false, description: "Включить полный текст актов (по умолчанию true)" },
    },
    response: `{
  "caseNumber": "11-90/2024",
  "caseUid": "...",
  "participants": [...],
  "events": [...],
  "documents": [...]
}`,
  },
  {
    id: "index_case",
    name: "Индексация дела",
    method: "POST",
    path: "/rest/index_case",
    tier: "RAG",
    description: "Добавить тексты судебных актов дела в локальный поисковый корпус.",
    request: {
      court: { type: "string", required: true, description: "Поддомен или название суда" },
      caseUrl: { type: "string", required: true, description: "URL карточки дела" },
      replace: { type: "boolean", required: false, description: "Переиндексировать, если уже есть" },
    },
    response: `{
  "caseUid": "...",
  "chunksAdded": 12,
  "corpusSize": 450,
  "corpusCases": 38
}`,
  },
  {
    id: "search_case_texts",
    name: "Поиск по текстам актов",
    method: "POST",
    path: "/rest/search_case_texts",
    tier: "RAG",
    description: "Полнотекстовый поиск по проиндексированным судебным актам (BM25).",
    request: {
      query: { type: "string", required: true, description: "Текстовый запрос на русском языке" },
      limit: { type: "number", required: false, description: "Максимум результатов (по умолчанию 10)" },
      court: { type: "string", required: false, description: "Фильтр по суду" },
      caseNumber: { type: "string", required: false, description: "Фильтр по номеру дела" },
    },
    response: `{
  "query": "...",
  "total": 5,
  "hits": [...]
}`,
  },
  {
    id: "list_indexed_cases",
    name: "Список проиндексированных дел",
    method: "GET",
    path: "/rest/list_indexed_cases",
    tier: "RAG",
    description: "Получить список всех дел в RAG-корпусе.",
    response: `{
  "corpusSize": 450,
  "caseCount": 38,
  "cases": [...]
}`,
  },
  {
    id: "remove_case",
    name: "Удаление дела из корпуса",
    method: "POST",
    path: "/rest/remove_case",
    tier: "RAG",
    description: "Удалить дело и все его фрагменты из RAG-корпуса.",
    request: {
      caseUid: { type: "string", required: true, description: "УИД дела для удаления" },
    },
    response: `{
  "caseUid": "...",
  "chunksRemoved": 12,
  "corpusSize": 438
}`,
  },
];

function generateCodeExample(
  endpoint: EndpointInfo,
  language: Language,
  baseUrl: string,
  token: string
): string {
  const placeholder = token || "YOUR_TOKEN";
  const url = baseUrl + endpoint.path;

  switch (language) {
    case "curl": {
      if (endpoint.method === "GET") {
        return `curl -H "Authorization: Bearer ${placeholder}" \\
  ${url}`;
      }
      const body = endpoint.request
        ? JSON.stringify(
            Object.keys(endpoint.request).reduce((acc, k) => {
              acc[k] = `<${k}>`;
              return acc;
            }, {} as Record<string, string>),
            null,
            2
          )
        : "{}";
      return `curl -X POST \\
  -H "Authorization: Bearer ${placeholder}" \\
  -H "Content-Type: application/json" \\
  -d '${body.replace(/\n/g, "\\n")}' \\
  ${url}`;
    }

    case "typescript": {
      const body = endpoint.request
        ? `{
  ${Object.keys(endpoint.request)
    .map((k) => `${k}: "<${k}>"`)
    .join(",\n  ")}
}`
        : "{}";
      return `const response = await fetch("${url}", {
  method: "${endpoint.method}",
  headers: {
    "Authorization": \`Bearer \${token}\`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify(${body})
});
const data = await response.json();`;
    }

    case "python": {
      const body = endpoint.request
        ? `{
    ${Object.keys(endpoint.request)
      .map((k) => `"${k}": "<${k}>"`)
      .join(",\n    ")}
}`
        : "{}";
      if (endpoint.method === "GET") {
        return `import requests

response = requests.get(
    "${url}",
    headers={"Authorization": f"Bearer {token}"}
)
data = response.json()`;
      }
      return `import requests

response = requests.post(
    "${url}",
    json=${body},
    headers={"Authorization": f"Bearer {token}"}
)
data = response.json()`;
    }

    case "javascript": {
      const body = endpoint.request
        ? `{
  ${Object.keys(endpoint.request)
    .map((k) => `${k}: "<${k}>"`)
    .join(",\n  ")}
}`
        : "{}";
      return `fetch("${url}", {
  method: "${endpoint.method}",
  headers: {
    "Authorization": \`Bearer \${token}\`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify(${body})
})
  .then(res => res.json())
  .then(data => console.log(data));`;
    }
  }
}

export default function ApiDocs() {
  const { user } = useAuth();
  const [activeEndpoint, setActiveEndpoint] = useState<Endpoint>("list_case_categories");
  const [language, setLanguage] = useState<Language>("curl");
  const [copied, setCopied] = useState(false);
  const [docsTab, setDocsTab] = useState<DocsTab>("start");

  const baseUrl = useMemo(() => {
    if (typeof window !== "undefined" && window.location?.origin) {
      return window.location.origin;
    }
    return "https://a2chatsky.ru";
  }, []);
  const token = user ? "YOUR_TOKEN_FROM_CABINET" : "YOUR_TOKEN";

  const endpoint = ENDPOINTS.find((e) => e.id === activeEndpoint)!;
  const codeExample = generateCodeExample(endpoint, language, baseUrl, token);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <main className="page-shell">
      <div className="mx-auto max-w-7xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/40">
            Документация
          </p>
          <h1 className="mt-1 font-display text-2xl text-white md:mt-2 md:text-4xl">
            REST API
          </h1>
          <p className="mt-2 max-w-3xl font-mono text-[12px] leading-relaxed text-white/55 md:mt-4 md:text-[13px]">
            HTTP API к ГАС «Правосудие». Bearer-токен из кабинета.
          </p>
        </motion.div>

        <div className="mt-5 md:mt-8">
          <SegmentTabs tabs={DOCS_TABS} value={docsTab} onChange={setDocsTab} sticky />
        </div>

        {/* ── Quick start ─────────────────────────────────────────────── */}
        <TabPanel always active={docsTab === "start"} className="mt-4 md:mt-8">
        <section className="border border-white/10 p-4 md:p-8">
          <h2 className="font-mono text-[12px] uppercase tracking-[0.25em] text-white/70 md:text-[13px]">
            Быстрый старт
          </h2>
          <p className="mt-3 font-mono text-[12px] text-white/50">
            1. Получите токен в{" "}
            {user ? (
              <a href="#/cabinet" className="text-white underline">
                кабинете
              </a>
            ) : (
              <span className="text-white/70">кабинете (требуется вход)</span>
            )}
          </p>
          <p className="mt-2 font-mono text-[12px] text-white/50">
            2. Добавьте заголовок <code className="text-white">Authorization: Bearer YOUR_TOKEN</code>
          </p>
          <p className="mt-2 font-mono text-[12px] text-white/50">
            3. Делайте запросы к <code className="text-white">{baseUrl}/rest/*</code>
          </p>

          <div className="mt-6 border-l-2 border-emerald-500/30 bg-emerald-500/5 p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-emerald-300/80">
              Пример
            </p>
            <pre className="mt-2 overflow-x-auto font-mono text-[11px] text-white/80">
{`curl -H "Authorization: Bearer YOUR_TOKEN" \\
  ${baseUrl}/rest/list_case_categories`}
            </pre>
          </div>
        </section>
        </TabPanel>

        {/* ── Endpoint reference ──────────────────────────────────────── */}
        <TabPanel always active={docsTab === "endpoints"} className="mt-4 md:mt-8">
        <section>
          <h2 className="font-mono text-[12px] uppercase tracking-[0.25em] text-white/70 md:text-[13px]">
            Справочник endpoints
          </h2>

          <div className="mt-4 grid gap-4 md:mt-6 md:gap-6 lg:grid-cols-[280px_1fr]">
            {/* Sidebar — horizontal on phone */}
            <nav className="tab-scroll pb-1 lg:sticky lg:top-24 lg:flex lg:h-fit lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
              {ENDPOINTS.map((ep) => (
                <button
                  key={ep.id}
                  type="button"
                  onClick={() => setActiveEndpoint(ep.id)}
                  className={`shrink-0 border px-3 py-2.5 text-left transition lg:w-full lg:px-4 lg:py-3 ${
                    ep.id === activeEndpoint
                      ? "border-white bg-white text-black"
                      : "border-white/10 text-white/60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] lg:text-[11px]">
                      {ep.name}
                    </span>
                    <span
                      className={`shrink-0 font-mono text-[8px] uppercase tracking-[0.15em] lg:text-[9px] ${
                        ep.tier === "2"
                          ? "text-yellow-400"
                          : ep.tier === "RAG"
                          ? "text-purple-400"
                          : "text-emerald-400"
                      }`}
                    >
                      {ep.tier === "1" ? "T1" : ep.tier === "2" ? "T2" : ep.tier}
                    </span>
                  </div>
                  <p className="mt-0.5 hidden font-mono text-[10px] text-inherit opacity-70 lg:mt-1 lg:block">
                    {ep.method} {ep.path.replace("/rest/", "")}
                  </p>
                </button>
              ))}
            </nav>

            {/* Main content */}
            <div className="border border-white/10 p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-mono text-lg uppercase tracking-[0.2em] text-white">
                    {endpoint.name}
                  </h3>
                  <p className="mt-2 font-mono text-[12px] text-white/60">{endpoint.description}</p>
                </div>
                <span
                  className={`shrink-0 border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.15em] ${
                    endpoint.tier === "2"
                      ? "border-yellow-500/40 text-yellow-300/80"
                      : endpoint.tier === "RAG"
                      ? "border-purple-500/40 text-purple-300/80"
                      : "border-emerald-500/40 text-emerald-300/80"
                  }`}
                >
                  {endpoint.tier === "1" ? "Tier 1" : endpoint.tier === "2" ? "Tier 2" : endpoint.tier}
                </span>
              </div>

              {/* Request */}
              <div className="mt-6">
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/50">
                  Запрос
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <span className="rounded border border-white/20 px-2 py-1 font-mono text-[11px] uppercase text-white/80">
                    {endpoint.method}
                  </span>
                  <code className="font-mono text-[12px] text-white">{endpoint.path}</code>
                </div>

                {endpoint.request && (
                  <div className="mt-4 space-y-3">
                    {Object.entries(endpoint.request).map(([key, val]) => (
                      <div key={key} className="border-l-2 border-white/10 pl-4">
                        <div className="flex items-center gap-2">
                          <code className="font-mono text-[12px] text-white">{key}</code>
                          <span className="font-mono text-[10px] text-white/40">{val.type}</span>
                          {val.required && (
                            <span className="rounded bg-red-500/20 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] text-red-300">
                              Обязательно
                            </span>
                          )}
                        </div>
                        <p className="mt-1 font-mono text-[11px] text-white/50">{val.description}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Response */}
              <div className="mt-6">
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/50">
                  Ответ (пример)
                </p>
                <pre className="mt-2 overflow-x-auto bg-white/[0.03] p-4 font-mono text-[11px] leading-relaxed text-white/70">
                  {endpoint.response}
                </pre>
              </div>

              {/* Code examples */}
              <div className="mt-8">
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/50">
                  Примеры кода
                </p>
                <div className="mt-3 flex gap-2">
                  {(["curl", "typescript", "python", "javascript"] as Language[]).map((lang) => (
                    <button
                      key={lang}
                      onClick={() => setLanguage(lang)}
                      className={`border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.15em] transition ${
                        language === lang
                          ? "border-white bg-white text-black"
                          : "border-white/20 text-white/60 hover:border-white/50"
                      }`}
                    >
                      {lang}
                    </button>
                  ))}
                </div>

                <div className="relative mt-4">
                  <pre className="overflow-x-auto bg-white/[0.03] p-4 font-mono text-[11px] leading-relaxed text-white/80">
                    {codeExample}
                  </pre>
                  <button
                    onClick={() => void copy(codeExample)}
                    className="absolute right-3 top-3 border border-white/20 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-white/60 transition hover:bg-white hover:text-black"
                  >
                    {copied ? "Скопировано" : "Копировать"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        </TabPanel>

        {/* ── Tiers explanation ───────────────────────────────────────── */}
        <TabPanel always active={docsTab === "tiers"} className="mt-4 md:mt-8">
        <section className="border border-white/10 p-4 md:p-8">
          <h2 className="font-mono text-[12px] uppercase tracking-[0.25em] text-white/70 md:text-[13px]">
            Уровни доступа (Tiers)
          </h2>
          <div className="mt-6 space-y-4">
            <div className="border-l-2 border-emerald-500/30 pl-4">
              <p className="font-mono text-[12px] uppercase tracking-[0.15em] text-emerald-300/80">
                Tier 1 — Быстрый HTTP
              </p>
              <p className="mt-2 font-mono text-[11px] text-white/60">
                Без капчи, простой HTTP-запрос. Расписание заседаний и карточки дел.
              </p>
            </div>
            <div className="border-l-2 border-yellow-500/30 pl-4">
              <p className="font-mono text-[12px] uppercase tracking-[0.15em] text-yellow-300/80">
                Tier 2 — Браузер + капча
              </p>
              <p className="mt-2 font-mono text-[11px] text-white/60">
                Расширенный поиск. Автоматическое решение капчи (ddddocr → 2Captcha). Медленнее.
              </p>
            </div>
            <div className="border-l-2 border-purple-500/30 pl-4">
              <p className="font-mono text-[12px] uppercase tracking-[0.15em] text-purple-300/80">
                RAG — Поисковый корпус
              </p>
              <p className="mt-2 font-mono text-[11px] text-white/60">
                Локальный полнотекстовый поиск по проиндексированным судебным актам (BM25).
              </p>
            </div>
          </div>
        </section>

        </TabPanel>

        {/* ── Full docs link ──────────────────────────────────────────── */}
        <TabPanel always active={docsTab === "more"} className="mt-4 md:mt-8">
        <section className="border border-white/10 bg-white/[0.02] p-4 md:p-8">
          <h2 className="font-mono text-[12px] uppercase tracking-[0.25em] text-white/70 md:text-[13px]">
            Полная документация
          </h2>
          <p className="mt-3 font-mono text-[12px] text-white/60">
            Подробное описание OAuth-авторизации, примеры клиентов на разных языках и smoke-тесты:
          </p>
          <a
            href="https://github.com/your-repo/sudrf-mcp/blob/main/REST_API.md"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-block border border-white px-6 py-3 font-mono text-[11px] uppercase tracking-[0.2em] text-white transition hover:bg-white hover:text-black"
          >
            REST_API.md на GitHub →
          </a>
        </section>
        </TabPanel>
      </div>
    </main>
  );
}
