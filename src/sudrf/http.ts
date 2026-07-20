import iconv from "iconv-lite";
import { ProxyAgent, fetch as undiciFetch } from "undici";

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let proxyAgent: ProxyAgent | null | undefined;

/** SUDRF_HTTP_PROXY / HTTPS_PROXY — residential gateway, e.g. http://user:pass_country-RU@host:1000 */
export function sudrfProxyUrl(): string | undefined {
  const raw =
    process.env.SUDRF_HTTP_PROXY?.trim()
    || process.env.HTTPS_PROXY?.trim()
    || process.env.HTTP_PROXY?.trim();
  return raw || undefined;
}

function getProxyAgent(): ProxyAgent | undefined {
  if (proxyAgent !== undefined) return proxyAgent ?? undefined;
  const url = sudrfProxyUrl();
  if (!url) {
    proxyAgent = null;
    return undefined;
  }
  proxyAgent = new ProxyAgent(url);
  console.log(`[fetchSudrf] proxy enabled → ${safeProxyHost(url)}`);
  return proxyAgent;
}

function safeProxyHost(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || "80"}`;
  } catch {
    return "(invalid proxy url)";
  }
}

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
}

export interface FetchResult {
  status: number;
  html: string;             // decoded to UTF-8
  headers: Record<string, string>;
  cookies: string;          // parsed Set-Cookie values joined
  url: string;              // final URL
}

export function courtFetchUrl(subdomain: string, path: string, preferHttp = false): string {
  const proto = preferHttp ? "http" : "https";
  return `${proto}://${subdomain}.sudrf.ru${path}`;
}

/** Detect TLS/SSL handshake or certificate errors from fetch / undici. */
export function isTlsOrSslError(e: unknown): boolean {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur; i++) {
    if (cur instanceof Error) {
      parts.push(cur.message);
      if (cur.cause) { cur = cur.cause; continue; }
    } else {
      parts.push(String(cur));
    }
    break;
  }
  const combined = parts.join(" ").toLowerCase();
  return /ssl|tls|cert|eproto|decryption|handshake|err_ssl|unable to verify|self.?signed|alert certificate|wrong version number/.test(combined);
}

/** Whether a failed HTTPS request should be retried over plain HTTP. */
export function shouldRetryWithHttp(e: unknown, usedHttps: boolean): boolean {
  if (!usedHttps) return false;
  if (isTlsOrSslError(e)) return true;
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return msg.includes("fetch failed");
}

// sudrf.ru serves Windows-1251. Node fetch gives us bytes via arrayBuffer();
// we decode with iconv-lite so cheerio sees proper UTF-8.
export async function fetchSudrf(opts: FetchOptions): Promise<FetchResult> {
  const preferHttp = opts.preferHttp ?? false;
  const urls = preferHttp
    ? [courtFetchUrl(opts.subdomain, opts.path, true), courtFetchUrl(opts.subdomain, opts.path, false)]
    : [courtFetchUrl(opts.subdomain, opts.path, false), courtFetchUrl(opts.subdomain, opts.path, true)];

  let lastErr: unknown;
  for (let i = 0; i < urls.length; i++) {
    try {
      return await fetchSudrfOnce(urls[i]!, opts);
    } catch (e) {
      lastErr = e;
      const canRetry = i === 0 && (preferHttp || shouldRetryWithHttp(e, !preferHttp));
      if (!canRetry) throw e;
      console.warn(`[fetchSudrf] ${urls[i]} failed (${e instanceof Error ? e.message : e}), retrying ${urls[1]}`);
    }
  }
  throw lastErr;
}

async function fetchSudrfOnce(url: string, opts: FetchOptions): Promise<FetchResult> {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30000);
  try {
    const dispatcher = getProxyAgent();
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
    res.headers.forEach((v, k) => { headers[k] = v; });
    const cookies = collectCookies(headers["set-cookie"] ?? "");
    detectAntibot(html, url);
    return { status: res.status, html, headers, cookies, url: res.url };
  } finally {
    clearTimeout(to);
  }
}

function detectCharset(ct: string, buf: Buffer): string {
  if (/charset=windows-1251/i.test(ct)) return "win1251";
  if (/charset=utf-8/i.test(ct)) return "utf8";
  // meta tag fallback
  const head = buf.slice(0, 1024).toString("latin1");
  if (/charset=windows-1251/i.test(head)) return "win1251";
  return "utf8";
}

function collectCookies(setCookie: string): string {
  if (!setCookie) return "";
  // set-cookie may be a single header with comma-separated values or multiple;
  // keep only name=value up to the first ';'
  return setCookie
    .split(/,(?=\s*[A-Za-z0-9_-]+=)/)
    .map(c => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

// Qrator/WebKnight challenges inject a JS redirect or a <noscript> meta-refresh
// to a /qaptcha/ or challenge path. Surface it loudly so the caller can fall
// back to Playwright instead of parsing a challenge page.
function detectAntibot(html: string, url: string): void {
  const signals = [
    /qrator/i,
    /qaptcha/i,
    /webknight/i,
    /ddos-guard/i,
    /document\.cookie\s*=\s*["'].*qrator/i,
    /<meta[^>]+http-equiv=["']refresh["'][^>]+url=\/qaptcha/i,
  ];
  for (const re of signals) {
    if (re.test(html)) {
      throw new Error(
        `Antibot challenge detected at ${url}. Falling back to Playwright is required.`
      );
    }
  }
}
