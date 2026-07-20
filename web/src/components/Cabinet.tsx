// Personal cabinet — MCP keys + endpoint + connection instructions.
//
// Two ways to connect an AI client to /mcp:
//   1. Bearer key (simple)  — paste a static token into any chat/curl/CLI.
//      Works everywhere that accepts a Bearer header. Shown once at creation.
//   2. OAuth (native)       — Claude / Cursor / Windsurf / Continue / Cline
//      discover the flow via /.well-known/* and run auth-code + PKCE. The
//      user logs in here and consents. Managed in the "Connected agents"
//      section below (revoke per agent).
//
// The config snippets are generated client-side from `endpoint` + the active
// key/token, with per-client tabs (Claude Desktop, Claude Code, Cursor, etc.).

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import SegmentTabs, { TabPanel } from "./SegmentTabs.js";

type CabTab = "card" | "endpoint" | "keys" | "agents" | "connect" | "invites";

const CAB_TABS: Array<{ id: CabTab; label: string }> = [
  { id: "card", label: "Карточка" },
  { id: "endpoint", label: "Эндпоинт" },
  { id: "keys", label: "Ключи" },
  { id: "agents", label: "Агенты" },
  { id: "connect", label: "Подключить" },
  { id: "invites", label: "Инвайты" },
];
import {
  createKey,
  deleteKey,
  listKeys,
  listOAuthSessions,
  disconnectOAuthClient,
  listInvites,
  createInvite,
  getMyPlayerCard,
  type ApiKey,
  type OAuthClientView,
  type OAuthTokenView,
  type InviteInfo,
} from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { navigate } from "./Router.js";
import PlayerCardSection from "./PlayerCardSection.js";

// ── AI client connection recipes ──────────────────────────────────────────
// Each recipe renders a tab in the "Connect" section. `kind` selects how the
// snippet is built: bearer (static key) or oauth (native discovery).
type RecipeKind = "bearer" | "oauth";

interface Recipe {
  id: string;
  label: string;
  kind: RecipeKind;
  blurb: string;          // one-line what-to-do, shown under the tab title
  steps: string[];        // ordered instructions
  // build the config snippet from the endpoint + a credential placeholder
  snippet: (endpoint: string, cred: string) => string;
  // the credential label shown in the snippet (e.g. <ваш-ключ>)
  credPlaceholder: string;
}

const BEARER_PH = "<ваш-ключ>";

const RECIPES: Recipe[] = [
  {
    id: "claude-desktop",
    label: "Claude Desktop",
    kind: "oauth",
    blurb: "Нативный OAuth — логин и согласие в браузере, ключи сами.",
    steps: [
      "Откройте Claude Desktop → Settings → Connector → Add custom connector.",
      "Введите URL эндпоинта (ниже) и нажмите Connect.",
      "В открывшемся окне войдите в кабинет и нажмите «Разрешить».",
      "Готово — сервер sudrf появится в списке инструментов Claude.",
    ],
    snippet: (endpoint) => endpoint,
    credPlaceholder: "",
  },
  {
    id: "claude-code",
    label: "Claude Code",
    kind: "oauth",
    blurb: "CLI сам пройдёт OAuth через браузер.",
    steps: [
      "В терминале выполните команду ниже.",
      "Откроется браузер — войдите в кабинет и нажмите «Разрешить».",
      "После согласия Claude Code подключится автоматически.",
    ],
    snippet: (endpoint) => `claude mcp add sudrf --transport http --url ${endpoint}`,
    credPlaceholder: "",
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    kind: "oauth",
    blurb: "Коннектор MCP через OAuth — URL сервера ниже.",
    steps: [
      "ChatGPT → Settings → Connectors → Add MCP server.",
      "URL: ниже (https://a2chatsky.ru/mcp). Нажмите Connect.",
      "Войдите в кабинет и нажмите «Разрешить».",
      "Инструменты: case_search (поиск по каталогу), search_cases (живой sudrf.ru), list_catalog_cases.",
    ],
    snippet: (endpoint) => endpoint,
    credPlaceholder: "",
  },
  {
    id: "cursor",
    label: "Cursor",
    kind: "oauth",
    blurb: "Streamable HTTP с OAuth-дискавери.",
    steps: [
      "Cursor → Settings → MCP → Add new MCP server.",
      "Type: http, URL — ниже. Authentication: OAuth.",
      "Нажмите Connect и пройдите согласие в браузере.",
    ],
    snippet: (endpoint) =>
      JSON.stringify(
        {
          mcpServers: {
            sudrf: { url: endpoint, transport: "http" },
          },
        },
        null,
        2
      ),
    credPlaceholder: "",
  },
  {
    id: "windsurf",
    label: "Windsurf",
    kind: "oauth",
    blurb: "HTTP transport, OAuth flow.",
    steps: [
      "Windsurf → Settings → MCP Servers → Add server.",
      "Выберите HTTP, вставьте URL ниже.",
      "Пройдите OAuth-согласие в открывшемся окне.",
    ],
    snippet: (endpoint) =>
      JSON.stringify(
        {
          mcpServers: {
            sudrf: { serverUrl: endpoint },
          },
        },
        null,
        2
      ),
    credPlaceholder: "",
  },
  {
    id: "continue",
    label: "Continue (VS Code / JetBrains)",
    kind: "bearer",
    blurb: "Статический bearer-ключ — вставьте токен из секции выше.",
    steps: [
      "Создайте ключ в секции «Ключи доступа» выше и скопируйте токен.",
      "Откройте config.yaml (Continue → Open config).",
      "Добавьте блок ниже, заменив <ваш-ключ> на токен.",
    ],
    snippet: (endpoint, cred) =>
      `mcpServers:\n  sudrf:\n    url: ${endpoint}\n    headers:\n      Authorization: Bearer ${cred}`,
    credPlaceholder: BEARER_PH,
  },
  {
    id: "cline",
    label: "Cline",
    kind: "bearer",
    blurb: "HTTP + Bearer-ключ из кабинета.",
    steps: [
      "Cline → Settings → MCP Servers → Edit JSON.",
      "Вставьте конфиг ниже, подставив скопированный токен.",
      "Перезапустите Cline.",
    ],
    snippet: (endpoint, cred) =>
      JSON.stringify(
        {
          mcpServers: {
            sudrf: {
              url: endpoint,
              transport: "http",
              headers: { Authorization: `Bearer ${cred}` },
            },
          },
        },
        null,
        2
      ),
    credPlaceholder: BEARER_PH,
  },
  {
    id: "zed",
    label: "Zed",
    kind: "bearer",
    blurb: "settings.json — HTTP + Bearer.",
    steps: [
      "Zed → Settings → Open settings.json.",
      "Добавьте секцию ниже с вашим токеном.",
    ],
    snippet: (endpoint, cred) =>
      JSON.stringify(
        {
          context_servers: {
            sudrf: {
              source: "http",
              url: endpoint,
              headers: { Authorization: `Bearer ${cred}` },
            },
          },
        },
        null,
        2
      ),
    credPlaceholder: BEARER_PH,
  },
  {
    id: "curl",
    label: "curl / любой HTTP",
    kind: "bearer",
    blurb: "Простейшая проверка — bearer в заголовке.",
    steps: [
      "Создайте ключ выше и скопируйте токен.",
      "Выполните запрос — увидите список инструментов.",
    ],
    snippet: (endpoint, cred) =>
      `curl -X POST ${endpoint} \\\n  -H "Authorization: Bearer ${cred}" \\\n  -H "Accept: application/json, text/event-stream" \\\n  -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`,
    credPlaceholder: BEARER_PH,
  },
];

// Map clientId → human label for the "Connected agents" list. OAuth clients
// register with a client_name; if missing we fall back to the id prefix.
function agentLabel(c: OAuthClientView): string {
  if (c.clientName && c.clientName !== "sudrf-mcp client") return c.clientName;
  return `Клиент ${c.clientId.slice(0, 8)}…`;
}

export default function Cabinet() {
  const { user, logout } = useAuth();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [endpoint, setEndpoint] = useState("");
  const [busy, setBusy] = useState(true);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [label, setLabel] = useState("default");
  const [copied, setCopied] = useState<string | null>(null);

  // OAuth sessions (connected AI agents)
  const [oauthClients, setOauthClients] = useState<OAuthClientView[]>([]);
  const [oauthTokens, setOauthTokens] = useState<OAuthTokenView[]>([]);
  const [oauthBusy, setOauthBusy] = useState(true);

  // Active recipe tab + which credential to bake into snippets
  const [activeRecipe, setActiveRecipe] = useState<string>("claude-desktop");
  const [cabTab, setCabTab] = useState<CabTab>("keys");
  const [invites, setInvites] = useState<InviteInfo[]>([]);
  const [inviteRemaining, setInviteRemaining] = useState(4);
  const [newInviteUrl, setNewInviteUrl] = useState<string | null>(null);
  const [playerCard, setPlayerCard] = useState<Awaited<ReturnType<typeof getMyPlayerCard>> | null>(null);

  const refreshPlayerCard = async () => {
    try {
      setPlayerCard(await getMyPlayerCard());
    } catch {
      setPlayerCard(null);
    }
  };

  const refreshInvites = async () => {
    try {
      const data = await listInvites();
      setInvites(data.invites);
      setInviteRemaining(data.remaining);
    } catch {
      /* ignore */
    }
  };

  const refresh = async () => {
    setBusy(true);
    try {
      const data = await listKeys();
      setKeys(data.keys);
      setEndpoint(data.mcpEndpoint);
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const refreshOAuth = async () => {
    setOauthBusy(true);
    try {
      const data = await listOAuthSessions();
      setOauthClients(data.clients);
      setOauthTokens(data.tokens);
      if (!endpoint) setEndpoint(data.mcpEndpoint);
    } catch {
      /* ignore */
    } finally {
      setOauthBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
    void refreshOAuth();
    void refreshInvites();
    void refreshPlayerCard();
  }, []);

  const onCreate = async () => {
    try {
      const data = await createKey(label.trim() || "default");
      setNewToken(data.key.token ?? null);
      setEndpoint(data.mcpEndpoint);
      void refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "ошибка");
    }
  };

  const onRevoke = async (id: string) => {
    if (!confirm("Отозвать этот ключ? Все клиенты, использующие его, немедленно потеряют доступ.")) return;
    try {
      await deleteKey(id);
      void refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "ошибка");
    }
  };

  const onDisconnectAgent = async (clientId: string, name: string) => {
    if (!confirm(`Отключить «${name}»? Агент потеряет доступ немедленно; при следующем подключении попросит согласие заново.`)) return;
    try {
      await disconnectOAuthClient(clientId);
      void refreshOAuth();
    } catch (e) {
      alert(e instanceof Error ? e.message : "ошибка");
    }
  };

  const copy = async (text: string, tag: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  if (!user) {
    navigate("/login");
    return null;
  }

  const recipe = RECIPES.find((r) => r.id === activeRecipe) ?? RECIPES[0];
  // For bearer recipes, bake in the freshly-created token if we have one,
  // otherwise the placeholder. OAuth recipes don't use a credential.
  const cred = recipe.kind === "bearer" ? (newToken ?? recipe.credPlaceholder) : "";
  const snippet = recipe.snippet(endpoint, cred);

  // Tokens grouped by client for the "Connected agents" view
  const tokensByClient = new Map<string, OAuthTokenView[]>();
  for (const t of oauthTokens) {
    const arr = tokensByClient.get(t.clientId) ?? [];
    arr.push(t);
    tokensByClient.set(t.clientId, arr);
  }

  return (
    <main className="page-shell">
      <div className="mx-auto max-w-4xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/40">
            Кабинет
          </p>
          <h1 className="mt-1 font-display text-2xl text-white md:mt-2 md:text-4xl">
            {user.email}
          </h1>
          <p className="mt-1.5 font-mono text-[11px] text-white/40 md:text-[12px]">
            {user.role} · ключей {keys.length} · агентов {oauthClients.length}
          </p>
        </motion.div>

        <div className="mt-5 md:mt-8">
          <SegmentTabs tabs={CAB_TABS} value={cabTab} onChange={setCabTab} sticky />
        </div>

        <TabPanel always active={cabTab === "card"} className="mt-4 md:mt-8">
          <PlayerCardSection data={playerCard} />
        </TabPanel>

        {/* ── Endpoint ─────────────────────────────────────────────────── */}
        <TabPanel always active={cabTab === "endpoint"} className="mt-4 md:mt-8">
        <section className="border border-white/10 p-4 md:p-6">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/50">
            MCP-эндпоинт
          </h2>
          <div className="mt-3 flex items-center gap-3">
            <code className="flex-1 break-all font-mono text-sm text-white">{endpoint}</code>
            <button
              onClick={() => void copy(endpoint, "endpoint")}
              className="shrink-0 border border-white/30 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.15em] text-white transition hover:bg-white hover:text-black"
            >
              {copied === "endpoint" ? "Скопировано" : "Копировать"}
            </button>
          </div>
          <p className="mt-3 font-mono text-[11px] text-white/30">
            Один адрес для всех клиентов. OAuth-клиенты (Claude, Cursor, Windsurf) обнаружат
            сервер автоматически через <code className="text-white/50">/.well-known/oauth-protected-resource</code>.
          </p>
        </section>
        </TabPanel>

        {/* ── Connected AI agents (OAuth) ──────────────────────────────── */}
        <TabPanel always active={cabTab === "agents"} className="mt-4 md:mt-8">
        <section className="border border-white/10 p-4 md:p-6">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/50">
            Подключённые ИИ-агенты
          </h2>
          <p className="mt-2 font-mono text-[12px] text-white/40">
            Агенты, которым вы дали доступ через OAuth-согласие. Отключите, чтобы отозвать их токены.
          </p>
          {oauthBusy ? (
            <p className="mt-4 font-mono text-sm text-white/40">загрузка…</p>
          ) : oauthClients.length === 0 ? (
            <p className="mt-4 font-mono text-sm text-white/40">
              Пока никто не подключён. Подключите Claude / Cursor / Windsurf через секцию ниже —
              они пройдут OAuth и появятся здесь.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-white/10">
              {oauthClients.map((c) => {
                const toks = tokensByClient.get(c.clientId) ?? [];
                const name = agentLabel(c);
                return (
                  <li key={c.clientId} className="flex items-center justify-between gap-4 py-4">
                    <div className="min-w-0">
                      <p className="font-mono text-sm text-white">{name}</p>
                      <p className="font-mono text-[11px] text-white/40">
                        client: {c.clientId.slice(0, 12)}… · scope: {c.scope} ·
                        подключён: {new Date(c.createdAt).toLocaleString("ru-RU")}
                      </p>
                      <p className="mt-1 font-mono text-[11px] text-white/30">
                        активных токенов: {toks.length}
                        {toks[0] ? ` · истекает ${new Date(toks[0].expiresAt).toLocaleString("ru-RU")}` : ""}
                      </p>
                    </div>
                    <button
                      onClick={() => void onDisconnectAgent(c.clientId, name)}
                      className="shrink-0 border border-white/20 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.15em] text-white/70 transition hover:border-red-500/50 hover:text-red-300"
                    >
                      Отключить
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        </TabPanel>

        {/* ── Bearer keys (simple path) ───────────────────────────────── */}
        <TabPanel always active={cabTab === "keys"} className="mt-4 md:mt-8">
        <section className="border border-white/10 p-4 md:p-6">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/50">
            Ключи доступа (простое подключение)
          </h2>
          <p className="mt-2 font-mono text-[12px] text-white/40">
            Статический bearer-токен — для клиентов без OAuth (Continue, Cline, Zed, curl).
            Токен показывается один раз при создании.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="метка (например, continue-vscode)"
              className="flex-1 border border-white/15 bg-black px-4 py-3 font-mono text-sm text-white outline-none focus:border-white/60"
            />
            <button
              onClick={onCreate}
              className="border border-white px-6 py-3 font-mono text-[12px] uppercase tracking-[0.2em] text-white transition hover:bg-white hover:text-black"
            >
              Сгенерировать
            </button>
          </div>

          {newToken && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-4 border border-yellow-500/30 bg-yellow-500/5 p-4"
            >
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-yellow-300/80">
                Сохраните этот токен — показывается один раз
              </p>
              <div className="mt-2 flex items-center gap-3">
                <code className="flex-1 break-all font-mono text-sm text-white">{newToken}</code>
                <button
                  onClick={() => void copy(newToken, "token")}
                  className="shrink-0 border border-white/30 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.15em] text-white transition hover:bg-white hover:text-black"
                >
                  {copied === "token" ? "Скопировано" : "Копировать"}
                </button>
              </div>
            </motion.div>
          )}

          <div className="mt-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
              Ваши ключи
            </p>
            {busy ? (
              <p className="mt-3 font-mono text-sm text-white/40">загрузка…</p>
            ) : keys.length === 0 ? (
              <p className="mt-3 font-mono text-sm text-white/40">Ключей пока нет — выдайте выше.</p>
            ) : (
              <ul className="mt-3 divide-y divide-white/10">
                {keys.map((k) => (
                  <li key={k.id} className="flex items-center justify-between py-4">
                    <div className="min-w-0">
                      <p className="font-mono text-sm text-white">{k.label}</p>
                      <p className="font-mono text-[11px] text-white/40">
                        id: {k.id} · создан: {new Date(k.createdAt).toLocaleString("ru-RU")}
                        {k.lastUsedAt ? ` · посл. использование: ${new Date(k.lastUsedAt).toLocaleString("ru-RU")}` : ""}
                      </p>
                    </div>
                    <button
                      onClick={() => onRevoke(k.id)}
                      className="shrink-0 border border-white/20 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.15em] text-white/70 transition hover:border-red-500/50 hover:text-red-300"
                    >
                      Отозвать
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        </TabPanel>

        {/* ── Connection instructions (per-client tabs) ───────────────── */}
        <TabPanel always active={cabTab === "connect"} className="mt-4 md:mt-8">
        <section className="border border-white/10 p-4 md:p-6">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/50">
            Подключение к ИИ-клиенту
          </h2>
          <p className="mt-2 font-mono text-[12px] text-white/40">
            Выберите клиент — для OAuth-клиентов достаточно URL, для остальных подставьте bearer-ключ.
          </p>

          <div className="mt-5 tab-scroll pb-1">
            {RECIPES.map((r) => {
              const active = r.id === activeRecipe;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setActiveRecipe(r.id)}
                  className={`shrink-0 border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] transition ${
                    active
                      ? "border-white bg-white text-black"
                      : "border-white/20 text-white/60"
                  }`}
                >
                  {r.label}
                </button>
              );
            })}
          </div>

          {/* Active recipe */}
          <div className="mt-5">
            <div className="flex items-center gap-3">
              <span
                className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.15em] ${
                  recipe.kind === "oauth"
                    ? "border-emerald-500/40 text-emerald-300/80"
                    : "border-yellow-500/40 text-yellow-300/80"
                }`}
              >
                {recipe.kind === "oauth" ? "OAuth" : "Bearer"}
              </span>
              <p className="font-mono text-[12px] text-white/50">{recipe.blurb}</p>
            </div>

            <ol className="mt-4 space-y-3 font-mono text-[12px] text-white/70">
              {recipe.steps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="shrink-0 text-white/30">{i + 1}.</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>

            <div className="relative mt-5">
              <pre className="overflow-x-auto bg-white/[0.03] p-4 font-mono text-[12px] leading-relaxed text-white/80">
{snippet}
              </pre>
              <button
                onClick={() => void copy(snippet, "snippet")}
                className="absolute right-3 top-3 border border-white/20 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-white/60 transition hover:bg-white hover:text-black"
              >
                {copied === "snippet" ? "Скопировано" : "Копировать"}
              </button>
            </div>

            {recipe.kind === "bearer" && !newToken && (
              <p className="mt-3 font-mono text-[11px] text-white/30">
                Сначала создайте ключ в секции выше — токен подставится в конфиг автоматически.
              </p>
            )}
          </div>
        </section>
        </TabPanel>

        <TabPanel always active={cabTab === "invites"} className="mt-4 md:mt-8">
        <section className="border border-white/10 p-4 md:p-6">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">Приглашения</h2>
          <p className="mt-2 font-mono text-[12px] text-white/50">
            До {inviteRemaining} из 4 ссылок на этой неделе. Новый пользователь заполнит ФИО и получит личную страницу.
          </p>
          <button
            type="button"
            disabled={inviteRemaining <= 0}
            onClick={async () => {
              try {
                const res = await createInvite();
                setNewInviteUrl(res.invite.url);
                void refreshInvites();
              } catch (e) {
                alert(e instanceof Error ? e.message : "ошибка");
              }
            }}
            className="mt-4 border border-sky-400/50 px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-sky-300 hover:bg-sky-400/10 disabled:opacity-30"
          >
            Создать ссылку
          </button>
          {newInviteUrl && (
            <div className="mt-4 border border-white/10 bg-black/40 p-3">
              <p className="break-all font-mono text-[11px] text-sky-200">{newInviteUrl}</p>
              <button type="button" onClick={() => void copy(newInviteUrl, "invite")} className="mt-2 font-mono text-[10px] text-white/50 hover:text-white">
                {copied === "invite" ? "Скопировано" : "Копировать"}
              </button>
            </div>
          )}
          {invites.length > 0 && (
            <ul className="mt-4 space-y-2 font-mono text-[10px] text-white/45">
              {invites.slice(0, 6).map((i) => (
                <li key={i.id} className="flex justify-between gap-2 border-b border-white/5 pb-2">
                  <span className="truncate">{i.usedAt ? "использовано" : "активно"} · до {new Date(i.expiresAt).toLocaleDateString("ru-RU")}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        </TabPanel>

        <div className="mt-8 flex flex-wrap gap-x-5 gap-y-3 md:mt-10">
          <button
            type="button"
            onClick={() => navigate("/profile")}
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/60 transition hover:text-white"
          >
            Профиль →
          </button>
          <button
            type="button"
            onClick={() => navigate("/api-docs")}
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/60 transition hover:text-white"
          >
            API →
          </button>
          {user.role === "admin" ? (
            <button
              type="button"
              onClick={() => navigate("/admin")}
              className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/60 transition hover:text-white"
            >
              Админ →
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void logout()}
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40 transition hover:text-white"
          >
            Выйти
          </button>
        </div>
      </div>
    </main>
  );
}
