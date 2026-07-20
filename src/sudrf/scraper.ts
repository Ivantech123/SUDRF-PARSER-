import { chromium, type Browser, type Page } from "playwright";
import type { CaseCategory, SearchFilters } from "./categories.js";
import { buildSearchParams } from "./categories.js";
import type { CaptchaSolver } from "./captcha.js";
import { courtFetchUrl, isTlsOrSslError, shouldRetryWithHttp } from "./http.js";
import { extractPaginationHrefs } from "./parsers.js";

// Tier-2 scraper: drives a real browser to satisfy the captcha gate on the
// extended case search (name_op=sf → sr). A single browser context is kept
// warm and reused so cookies / sessions persist across searches.

export interface ScraperConfig {
  headless?: boolean;             // default true; set false to watch captcha
  solver: CaptchaSolver;
  navigationTimeoutMs?: number;
  maxCaptchaRetries?: number;     // default 3
}

export class SudrfScraper {
  private browser?: Browser;
  constructor(private cfg: ScraperConfig) {}

  private async browser_(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await chromium.launch({
        headless: this.cfg.headless ?? true,
        args: ["--disable-blink-features=AutomationControlled"],
      });
    }
    return this.browser;
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = undefined;
  }

  // Search cases for one category. Returns the raw results HTML (name_op=sr)
  // so the caller can run parseSearchResults() on it. We do the captcha dance
  // inside the browser, then submit the form via the page (not fetch) so the
  // session cookies set by the captcha verification travel with the request.
  // Returns the results HTML for page 1 and every follow-up page, all fetched
  // within the SAME warm page so the captcha-verified session travels along.
  // Follows pagination BFS (page=2..N) up to maxPages. Callers parse each.
  async searchCases(
    subdomain: string,
    category: CaseCategory,
    filters: SearchFilters,
    preferHttp = false,
    maxPages = 40,
  ): Promise<string[]> {
    const page = await (await this.browser_()).newPage();
    try {
      await page.setDefaultTimeout(this.cfg.navigationTimeoutMs ?? 45000);
      const formPath = `/modules.php?name=sud_delo&srv_num=1&name_op=sf&nc=1&delo_id=${category.deloId}`;
      await gotoCourtPage(page, subdomain, formPath, preferHttp);

      const params = buildSearchParams(category, filters);
      // Fill the visible inputs that exist on this form. Field names are
      // category-specific; we set only the ones present in the DOM.
      for (const [name, value] of Object.entries(params)) {
        if (["name", "srv_num", "name_op", "nc", "delo_id", "case_type", "delo_table", "Submit"].includes(name)) continue;
        if (!value) continue;
        const sel = `input[name="${name}"]`;
        const el = await page.$(sel);
        if (el) await el.fill(value);
      }

      // Solve captcha. Retry on OCR mistakes — the page re-issues a fresh
      // captchaid + image on each load, so on failure we reload and retry.
      const maxRetries = this.cfg.maxCaptchaRetries ?? 3;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const { captchaid, imageB64 } = await extractCaptcha(page);
        if (!captchaid || !imageB64) {
          // No captcha on this form (some courts disable it) — submit directly.
          break;
        }
        const code = await this.cfg.solver.solve(imageB64);
        await page.fill("input[name='captcha']", code);
        // captchaid is a hidden input already set by the page; keep it as-is.
        void captchaid;

        // Submit and detect whether we land on results vs. back on the form
        // (a wrong captcha reloads the form with a new challenge).
        await Promise.all([
          page.waitForLoadState("domcontentloaded"),
          page.click("input[name='Submit']"),
        ]);
        // The results page is server-rendered, but give it a beat so the
        // #tablcont table is fully present before we read content.
        await page.waitForTimeout(1500);

        const html = await page.content();
        const captchaStillThere = /name=['"]captcha['"]/i.test(html)
          && /name=['"]captchaid['"]/i.test(html);
        const hasResults = /id=['"]tablcont['"]/i.test(html)
          || /№\s*дела|номер дела|всего по запросу найдено/i.test(html);
        const noResults = /данных по запросу не обнаружено|дел не найдено|ничего не найдено/i.test(html);
        if (!captchaStillThere || hasResults || noResults) {
          // Gate passed — page 1 is in hand. Now walk pagination in the same
          // authenticated page (page=2..N carry no captcha) and collect all.
          const pages = [html];
          if (!noResults) await this.collectPages(page, subdomain, html, pages, maxPages, preferHttp);
          return pages;
        }
        // captcha still present → wrong code → reload form and retry
        await gotoCourtPage(page, subdomain, formPath, preferHttp);
        // refill filters
        for (const [name, value] of Object.entries(params)) {
          if (!value) continue;
          const el = await page.$(`input[name="${name}"]`);
          if (el) await el.fill(value);
        }
      }
      throw new Error(`Captcha not solved after ${maxRetries} attempts`);
    } finally {
      await page.close();
    }
  }

  // Walk results pagination inside an already-authenticated page. BFS over
  // page=2..N links, re-reading the pagination row on each fetched page since
  // sudrf only shows a sliding window of page links.
  private async collectPages(
    page: Page,
    subdomain: string,
    firstHtml: string,
    out: string[],
    maxPages: number,
    preferHttp: boolean,
  ): Promise<void> {
    const visited = new Set<string>();
    const queue: string[] = [];
    const enqueue = (html: string) => {
      for (const href of extractPaginationHrefs(html)) {
        if (!visited.has(href) && !queue.includes(href)) queue.push(href);
      }
    };
    enqueue(firstHtml);
    while (queue.length && out.length < maxPages) {
      const href = queue.shift()!;
      visited.add(href);
      try {
        await gotoCourtPage(page, subdomain, href, preferHttp);
        await page.waitForTimeout(400);
        const html = await page.content();
        const parsedHasRows = /case_id=/i.test(html);
        if (!parsedHasRows) continue;
        out.push(html);
        enqueue(html);
      } catch {
        continue; // skip a bad page, keep draining
      }
    }
  }

  // Fetch a case detail page (no captcha on detail view) via the browser
  // context so session cookies are reused.
  async getCasePage(subdomain: string, casePath: string, preferHttp = false): Promise<string> {
    const page = await (await this.browser_()).newPage();
    try {
      const path = casePath.startsWith("http")
        ? new URL(casePath).pathname + new URL(casePath).search
        : casePath;
      await gotoCourtPage(page, subdomain, path, preferHttp, 45_000);
      // Must await before finally closes the page — otherwise content() races close().
      return await page.content();
    } finally {
      await page.close().catch(() => undefined);
    }
  }
}

// Navigate to a court page, preferring http:// for Tier-1 courts and
// falling back to the alternate protocol on TLS/SSL failures.
async function gotoCourtPage(
  page: Page,
  subdomain: string,
  path: string,
  preferHttp: boolean,
  timeoutMs = 45_000,
): Promise<void> {
  const urls = preferHttp
    ? [courtFetchUrl(subdomain, path, true), courtFetchUrl(subdomain, path, false)]
    : [courtFetchUrl(subdomain, path, false), courtFetchUrl(subdomain, path, true)];

  let lastErr: Error | undefined;
  for (let i = 0; i < urls.length; i++) {
    try {
      await page.goto(urls[i]!, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      return;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      const canRetry = i === 0 && (preferHttp || shouldRetryWithHttp(e, !preferHttp) || isTlsOrSslError(e));
      if (!canRetry) throw lastErr;
      console.warn(`[scraper] ${urls[i]} navigation failed (${lastErr.message}), retrying ${urls[1]}`);
    }
  }
  throw lastErr ?? new Error("navigation failed");
}

// Pull the captcha image (inline base64 PNG) and the hidden captchaid from
// the loaded form page. sudrf emits the data URI with a space after the colon
// ("data: image/png;base64, ..."), so we match permissively.
async function extractCaptcha(page: Page): Promise<{ captchaid?: string; imageB64?: string }> {
  const captchaid = await page.$eval("input[name='captchaid']", el => (el as HTMLInputElement).value).catch(() => undefined);
  const imageB64 = await page.$$eval("img", els => {
    for (const e of els) {
      const src = e.getAttribute("src") ?? "";
      if (/^data:\s*image\/png;base64,/i.test(src)) {
        // strip the data-uri prefix and any embedded whitespace
        return src.replace(/^data:\s*image\/png;base64,\s*/i, "").replace(/\s+/g, "");
      }
    }
    return "";
  }).catch(() => "");
  return { captchaid, imageB64: imageB64 || undefined };
}
