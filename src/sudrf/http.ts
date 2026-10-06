import iconv from "iconv-lite";
import { ProxyAgent, fetch as undiciFetch } from "undici";

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ── Tunables ────────────────────────────────────────────────────────────
// Every knob is env-driven so operators can trade politeness for throughput
// without a rebuild. Defaults are deliberately conservative: sudrf.ru is a
// government portal on shared hosting and aggressive crawling earns a Qrator
// block that costs far more than the few hundred ms saved.

function envInt(name: string, fallback: number, min = 0): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.trunc(n));
}

/** Retries after the first attempt. SUDRF_MAX_RETRIES=0 restores pre-0.2 behaviour. */
function maxRetries(): number {
  return envInt("SUDRF_MAX_RETRIES", 3);
}

/** First backoff step; doubles per attempt up to the cap. */
function retryBaseMs(): number {
  return envInt("SUDRF_RETRY_BASE_MS", 800, 50);
}

function retryCapMs(): number {
  return envInt("SUDRF_RETRY_CAP_MS", 15_000, 100);
}

/** Minimum gap between two requests to the same court host. 0 disables. */
function minHostIntervalMs(): number {
  return envInt("SUDRF_MIN_INTERVAL_MS", 250);
}

/** Upper bound on how long we will obey a server's Retry-After. */
function maxRetryAfterMs(): number {
  return envInt("SUDRF_MAX_RETRY_AFTER_MS", 60_000, 0);
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

// ── Proxy ───────────────────────────────────────────────────────────────
// SUDRF_HTTP_PROXY may hold several comma/whitespace-separated gateways; we
// round-robin per request so a pool of residential exits actually rotates
// (a single cached agent pinned every request to one exit).

let proxyUrlCache: string[] | undefined;
const proxyAgents = new Map<string, ProxyAgent>();
let proxyCursor = 0;

/** Configured proxy gateways, in declaration order. Empty when unset. */
export function sudrfProxyUrls(): string[] {
  if (proxyUrlCache !== undefined) return proxyUrlCache;
  const raw =
    process.env.SUDRF_HTTP_PROXY?.trim()
    || process.env.HTTPS_PROXY?.trim()
    || process.env.HTTP_PROXY?.trim()
    || "";
  proxyUrlCache = raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (proxyUrlCache.length) {
    console.log(
      `[fetchSudrf] proxy enabled → ${proxyUrlCache.map(safeProxyHost).join(", ")}`,
    );
  }
  return proxyUrlCache;
}

/** First configured gateway, kept for backward compatibility. */
export function sudrfProxyUrl(): string | undefined {
  return sudrfProxyUrls()[0];
}

/** Forget cached gateways/agents — used by tests after mutating env. */
export function resetSudrfProxyCache(): void {
  proxyUrlCache = undefined;
  proxyAgents.clear();
  proxyCursor = 0;
}

function nextProxyAgent(): ProxyAgent | undefined {
  const urls = sudrfProxyUrls();
  if (!urls.length) return undefined;
  const url = urls[proxyCursor % urls.length]!;
  proxyCursor = (proxyCursor + 1) % urls.length;
  let agent = proxyAgents.get(url);
  if (!agent) {
    agent = new ProxyAgent(url);
    proxyAgents.set(url, agent);
  }
  return agent;
}

function safeProxyHost(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || "80"}`;
  } catch {
    return "(invalid proxy url)";
  }
}

// ── Public types ────────────────────────────────────────────────────────

export interface FetchOptions {
  subdomain: string;
  path: string;             // e.g. "/modules.php?name=sud_delo&..."
  /** Registry http:true → plain HTTP (Tier 1). Default false (HTTPS). */
  preferHttp?: boolean;
  method?: "GET" | "POST";
  body?: URLSearchParams | string;
  headers?: Record<string, string>;
  cookies?: string;         // Cookie header value
  timeoutMs?: number;
  /** Override SUDRF_MAX_RETRIES for this call (0 = single attempt). */
  retries?: number;
  /** Skip the per-host politeness gate (for latency-critical one-offs). */
  noThrottle?: boolean;
}

export interface FetchResult {
  status: number;
  ok: boolean;              // status in 200..299
  html: string;             // decoded to UTF-8
  headers: Record<string, string>;
  cookies: string;          // parsed Set-Cookie values joined
  url: string;              // final URL
  attempts: number;         // transport attempts spent (1 = first try)
}

/**
 * Thrown when the server kept answering with a transient status (429/5xx)
 * until the retry budget ran out. The body of such a response is an error
 * page, never case data, so callers must not parse it — previously it was
 * handed to the HTML parsers, which then reported a bogus "layout changed".
 */
export class SudrfHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
    readonly attempts: number,
  ) {
    super(message);
    this.name = "SudrfHttpError";
  }
}

/** Antibot challenge (Qrator/WebKnight). Retrying over HTTP cannot clear it. */
export class SudrfAntibotError extends Error {
  constructor(readonly url: string) {
    super(`Antibot challenge detected at ${url}. Falling back to Playwright is required.`);
    this.name = "SudrfAntibotError";
  }
}

export function courtFetchUrl(subdomain: string, path: string, preferHttp = false): string {
  const proto = preferHttp ? "http" : "https";
  return `${proto}://${subdomain}.sudrf.ru${path}`;
}

// ── Retry classification ────────────────────────────────────────────────

/**
 * Statuses worth another attempt. 429/503 are sudrf's standard "slow down",
 * and 500/502/504 are routinely transient on these hosts. 403/404 are not —
 * they are stable answers, so we hand the body back to the caller.
 */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 509, 521, 522, 523, 524]);

export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

/** Flatten an error chain (undici nests the real cause) into one string. */
function errorChainText(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur != null; i++) {
    if (cur instanceof Error) {
      parts.push(cur.message);
      const code = (cur as NodeJS.ErrnoException).code;
      if (code) parts.push(code);
      cur = cur.cause;
      continue;
    }
    parts.push(String(cur));
    break;
  }
  return parts.join(" ").toLowerCase();
}

/** Detect TLS/SSL handshake or certificate errors from fetch / undici. */
export function isTlsOrSslError(e: unknown): boolean {
  return /ssl|tls|cert|eproto|decryption|handshake|err_ssl|unable to verify|self.?signed|alert certificate|wrong version number/
    .test(errorChainText(e));
}

/** Whether a failed HTTPS request should be retried over plain HTTP. */
export function shouldRetryWithHttp(e: unknown, usedHttps: boolean): boolean {
  if (!usedHttps) return false;
  if (isTlsOrSslError(e)) return true;
  return errorChainText(e).includes("fetch failed");
}

/**
 * Transport-level faults that typically clear on their own: resets, timeouts,
 * DNS blips, dropped sockets. A deliberate abort is excluded — that is our own
 * timeout firing and is already reported to the caller.
 */
export function isRetryableNetworkError(e: unknown): boolean {
  if (e instanceof SudrfAntibotError || e instanceof SudrfHttpError) return false;
  const text = errorChainText(e);
  // ENOTFOUND is "no such host" — permanent for a bad subdomain, and retrying
  // it on every unknown court would cost four attempts each. EAI_AGAIN is the
  // transient DNS failure and is worth another go.
  if (/enotfound/.test(text)) return /eai_again/.test(text);
  return /eai_again|econnreset|econnrefused|econnaborted|etimedout|epipe|ehostunreach|enetunreach|socket hang up|other side closed|terminated|fetch failed|und_err_socket|und_err_connect_timeout|headers timeout|body timeout|request timeout/
    .test(text);
}

/**
 * Parse a Retry-After header into milliseconds. Accepts delta-seconds and
 * HTTP-dates; returns null when absent/garbage so the caller falls back to
 * exponential backoff. Clamped to SUDRF_MAX_RETRY_AFTER_MS so a hostile
 * "Retry-After: 86400" cannot park a worker for a day.
 */
export function parseRetryAfter(
  value: string | undefined | null,
  nowMs: number = Date.now(),
  capMs: number = maxRetryAfterMs(),
): number | null {
  const raw = value?.trim();
  if (!raw) return null;
  let ms: number;
  if (/^\d+$/.test(raw)) {
    ms = Number(raw) * 1000;
  } else {
    const at = Date.parse(raw);
    if (!Number.isFinite(at)) return null;
    ms = at - nowMs;
  }
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.min(ms, capMs);
}

/**
 * Exponential backoff with full jitter: base * 2^attempt, capped, then
 * randomised across [0, window]. Full jitter matters here because the
 * scheduler hits many courts at once — synchronised retries would re-create
 * the burst that triggered the 429 in the first place.
 */
export function backoffDelayMs(
  attempt: number,
  baseMs: number = retryBaseMs(),
  capMs: number = retryCapMs(),
  rand: () => number = Math.random,
): number {
  const window = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.round(window * rand());
}

// ── Per-host politeness gate ────────────────────────────────────────────

/**
 * Serialises requests per court host and keeps a minimum gap between them.
 * Different hosts stay fully parallel, so scheduler throughput (which fans out
 * across courts) is unchanged — this only stops us hammering one subdomain
 * with back-to-back pagination/enrich calls.
 */
export class HostGate {
  private chains = new Map<string, Promise<unknown>>();
  private lastStartedAt = new Map<string, number>();

  constructor(
    private minIntervalMs: number,
    private now: () => number = Date.now,
    private sleep: (ms: number) => Promise<void> = sleepMs,
  ) {}

  /** Queued hosts — exposed for tests/diagnostics. */
  get pendingHosts(): number {
    return this.chains.size;
  }

  run<T>(host: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(host) ?? Promise.resolve();
    const task = prev.then(async () => {
      const last = this.lastStartedAt.get(host);
      if (last !== undefined) {
        const wait = this.minIntervalMs - (this.now() - last);
        if (wait > 0) await this.sleep(wait);
      }
      this.lastStartedAt.set(host, this.now());
      return fn();
    });
    // Tail must never reject, or every later request on this host inherits
    // the failure. Prune the chain once we are the last one queued.
    const tail = task.then(
      () => undefined,
      () => undefined,
    ).then(() => {
      if (this.chains.get(host) === tail) this.chains.delete(host);
    });
    this.chains.set(host, tail);
    return task;
  }
}

let gate: HostGate | undefined;

function hostGate(): HostGate {
  gate ??= new HostGate(minHostIntervalMs());
  return gate;
}

/** Drop the shared gate — used by tests after mutating env. */
export function resetHostGate(): void {
  gate = undefined;
}

// ── Fetch ───────────────────────────────────────────────────────────────

// sudrf.ru serves Windows-1251. Node fetch gives us bytes via arrayBuffer();
// we decode with iconv-lite so cheerio sees proper UTF-8.
export async function fetchSudrf(opts: FetchOptions): Promise<FetchResult> {
  const host = opts.subdomain.trim().toLowerCase();
  if (opts.noThrottle || minHostIntervalMs() === 0) return fetchSudrfRetrying(opts);
  return hostGate().run(host, () => fetchSudrfRetrying(opts));
}

/**
 * Retry loop around the transport. Gives up immediately on antibot challenges
 * (only Playwright can clear those) and on stable 4xx, retries 429/5xx and
 * transient transport faults with jittered backoff.
 */
async function fetchSudrfRetrying(opts: FetchOptions): Promise<FetchResult> {
  const budget = opts.retries ?? maxRetries();
  const base = retryBaseMs();
  const cap = retryCapMs();
  let attempt = 0;

  for (;;) {
    attempt++;
    try {
      const res = await fetchSudrfTransport(opts, attempt);
      if (!isRetryableStatus(res.status)) return res;

      if (attempt > budget) {
        throw new SudrfHttpError(
          `HTTP ${res.status} from ${res.url} after ${attempt} attempt(s)`,
          res.status,
          res.url,
          attempt,
        );
      }
      const wait = parseRetryAfter(res.headers["retry-after"]) ?? backoffDelayMs(attempt - 1, base, cap);
      console.warn(
        `[fetchSudrf] ${res.url} → HTTP ${res.status}, retry ${attempt}/${budget} in ${wait}ms`,
      );
      await sleepMs(wait);
    } catch (e) {
      if (e instanceof SudrfHttpError || e instanceof SudrfAntibotError) throw e;
      if (attempt > budget || !isRetryableNetworkError(e)) throw e;
      const wait = backoffDelayMs(attempt - 1, base, cap);
      console.warn(
        `[fetchSudrf] ${opts.subdomain}${opts.path} → ${e instanceof Error ? e.message : e}, retry ${attempt}/${budget} in ${wait}ms`,
      );
      await sleepMs(wait);
    }
  }
}

/** One transport pass, including the HTTPS↔HTTP scheme fallback. */
async function fetchSudrfTransport(opts: FetchOptions, attempts: number): Promise<FetchResult> {
  const preferHttp = opts.preferHttp ?? false;
  const urls = preferHttp
    ? [courtFetchUrl(opts.subdomain, opts.path, true), courtFetchUrl(opts.subdomain, opts.path, false)]
    : [courtFetchUrl(opts.subdomain, opts.path, false), courtFetchUrl(opts.subdomain, opts.path, true)];

  let lastErr: unknown;
  for (let i = 0; i < urls.length; i++) {
    try {
      return await fetchSudrfOnce(urls[i]!, opts, attempts);
    } catch (e) {
      lastErr = e;
      if (e instanceof SudrfAntibotError) throw e;
      const canRetry = i === 0 && (preferHttp || shouldRetryWithHttp(e, !preferHttp));
      if (!canRetry) throw e;
      console.warn(`[fetchSudrf] ${urls[i]} failed (${e instanceof Error ? e.message : e}), retrying ${urls[1]}`);
    }
  }
  throw lastErr;
}

async function fetchSudrfOnce(url: string, opts: FetchOptions, attempts: number): Promise<FetchResult> {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30000);
  try {
    const dispatcher = nextProxyAgent();
    const res = await undiciFetch(url, {
      method: opts.method ?? "GET",
      headers: {
        "User-Agent": DEFAULT_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
        "Accept-Encoding": "identity",   // no gzip — we need raw 1251 bytes
        ...(opts.cookies ? { Cookie: opts.cookies } : {}),
        ...(opts.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...opts.headers,
      },
      body: opts.body,
      signal: controller.signal,
      redirect: "follow",
      ...(dispatcher ? { dispatcher } : {}),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const charset = detectCharset(res.headers.get("content-type") ?? "", buf);
    const html = iconv.decode(buf, charset);
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    const cookies = collectCookies(headers["set-cookie"] ?? "");
    detectAntibot(html, url);
    return {
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      html,
      headers,
      cookies,
      url: res.url,
      attempts,
    };
  } finally {
    clearTimeout(to);
  }
}

function detectCharset(ct: string, buf: Buffer): string {
  if (/charset=windows-1251/i.test(ct)) return "win1251";
  if (/charset=utf-8/i.test(ct)) return "utf8";
  // meta tag fallback
  const head = buf.subarray(0, 1024).toString("latin1");
  if (/charset=windows-1251/i.test(head)) return "win1251";
  return "utf8";
}

export function collectCookies(setCookie: string): string {
  if (!setCookie) return "";
  // set-cookie may be a single header with comma-separated values or multiple;
  // keep only name=value up to the first ';'
  return setCookie
    .split(/,(?=\s*[A-Za-z0-9_-]+=)/)
    .map(c => c.split(";")[0]!.trim())
    .filter(Boolean)
    .join("; ");
}

// Qrator/WebKnight challenges inject a JS redirect or a <noscript> meta-refresh
// to a /qaptcha/ or challenge path. Surface it loudly so the caller can fall
// back to Playwright instead of parsing a challenge page.
const ANTIBOT_SIGNALS = [
  /qrator/i,
  /qaptcha/i,
  /webknight/i,
  /ddos-guard/i,
  /document\.cookie\s*=\s*["'].*qrator/i,
  /<meta[^>]+http-equiv=["']refresh["'][^>]+url=\/qaptcha/i,
];

export function isAntibotHtml(html: string): boolean {
  return ANTIBOT_SIGNALS.some((re) => re.test(html));
}

function detectAntibot(html: string, url: string): void {
  if (isAntibotHtml(html)) throw new SudrfAntibotError(url);
}
