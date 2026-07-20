import { fetchSudrf } from "./http.js";
import { parseHearingSchedule, parseSearchResults, isNoResults, extractPaginationHrefs } from "./parsers.js";
import { parseCaseDetails } from "./case-parser.js";
import { courtBaseUrl, type CourtEntry } from "./courts.js";
import { findCourt, resolveCourtQuery } from "./court-search.js";
import { categoryByDeloId, CASE_CATEGORIES, buildSearchParams, type CaseCategory, type SearchFilters } from "./categories.js";
import { SudrfScraper } from "./scraper.js";
import { ResidentDdddocrSolver, TwoCaptchaSolver, ChainedSolver, type CaptchaSolver } from "./captcha.js";
import type { HearingSchedule, CaseSearchResponse, CaseDetails } from "./types.js";

export interface SudrfClientOptions {
  solver?: CaptchaSolver;
  headless?: boolean;
  twoCaptchaKey?: string;     // optional paid fallback
}

// High-level facade: one entry point for both tiers.
//   Tier 1 (no captcha): getHearingSchedule
//   Tier 2 (captcha):    searchCases
export class SudrfClient {
  private scraper?: SudrfScraper;
  constructor(private opts: SudrfClientOptions = {}) {}

  private residentSolver?: ResidentDdddocrSolver;

  private solver_(): CaptchaSolver {
    if (this.opts.solver) return this.opts.solver;
    // Persistent OCR daemon: the ddddocr model loads once, not per captcha.
    this.residentSolver ??= new ResidentDdddocrSolver(process.env.PYTHON_BIN);
    const fallback = this.opts.twoCaptchaKey ? new TwoCaptchaSolver(this.opts.twoCaptchaKey) : undefined;
    return new ChainedSolver(this.residentSolver, fallback);
  }

  private scraper_(): SudrfScraper {
    if (!this.scraper) {
      this.scraper = new SudrfScraper({
        solver: this.solver_(),
        headless: this.opts.headless ?? true,
      });
    }
    return this.scraper;
  }

  async close(): Promise<void> {
    await this.scraper?.close();
    this.residentSolver?.close();
    this.residentSolver = undefined;
  }

  // Resolve a court from a name/region/subdomain/vnkod query. If not in the
  // registry, treat the query itself as a raw subdomain (e.g. "vs--mor").
  resolveCourt(query: string): CourtEntry {
    const found = findCourt(query);
    if (found) return found;
    // Unknown court: assume captcha + browser (safest default for raw subdomains).
    return { subdomain: query, name: query, region: "", type: "other", vnkod: "", captcha: true, http: false };
  }

  resolveCourtWithCandidates(query: string) {
    return resolveCourtQuery(query);
  }

  // Tier 1: list cases scheduled for a hearing date. No captcha.
  async getHearingSchedule(courtQuery: string, date: string): Promise<HearingSchedule> {
    const court = this.resolveCourt(courtQuery);
    const path = `/modules.php?name=sud_delo&srv_num=1&H_date=${encodeURIComponent(date)}`;
    try {
      const res = await fetchSudrf({ subdomain: court.subdomain, path, preferHttp: court.http });
      return parseHearingSchedule(res.html, court.name, date);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/antibot|qrator|qaptcha/i.test(msg)) {
        return {
          court: court.name,
          date,
          count: 0,
          items: [],
          parseStatus: "antibot",
          warning: msg,
        };
      }
      throw e;
    }
  }

  // Tier 2: extended case search. Drives Playwright + captcha solver.
  // Fast path: courts flagged http=true + captcha=false in the registry can be
  // searched via plain HTTP POST (no browser, no OCR) — ~940 of ~2270 courts.
  // Falls back to the browser session for captcha-gated or SELENIUM-only courts.
  async searchCases(
    courtQuery: string,
    categoryDeloId: number,
    filters: SearchFilters,
    opts?: { maxPages?: number }
  ): Promise<CaseSearchResponse> {
    const court = this.resolveCourt(courtQuery);
    const cat = categoryByDeloId(categoryDeloId);
    if (!cat) throw new Error(`Unknown delo_id ${categoryDeloId}. Use list_case_categories.`);
    const params = buildSearchParams(cat, filters);
    // Hard ceiling on pages followed per search — a runaway "all years" window
    // could otherwise page forever. 25 rows/page → 40 pages = 1000 cases.
    const maxPages = opts?.maxPages ?? 40;

    // Collect the results HTML for every page. The browser path does its own
    // in-session pagination; the HTTP path pages here via follow-up GETs.
    let pages: string[] = [];
    if (court.http && !court.captcha) {
      // Fast path: plain HTTP. name_op=sr submits the search directly.
      try {
        const body = new URLSearchParams(params);
        const res = await fetchSudrf({
          subdomain: court.subdomain,
          path: `/modules.php?name=sud_delo&srv_num=1`,
          method: "POST",
          body,
          preferHttp: court.http,
        });
        pages = [res.html, ...(await this.paginateHttp(court.subdomain, res.html, court.http, maxPages))];
      } catch {
        // antibot or transport error → fall back to browser
        pages = await this.scraper_().searchCases(court.subdomain, cat, filters, court.http, maxPages);
      }
    } else {
      pages = await this.scraper_().searchCases(court.subdomain, cat, filters, court.http, maxPages);
    }

    if (!pages.length || (pages.length === 1 && isNoResults(pages[0]!))) {
      return { court: court.name, category: cat.label, total: 0, results: [] };
    }

    // Merge every page, de-duping rows by caseUid (fallback caseNumber).
    const first = parseSearchResults(pages[0]!, court.name, cat.label);
    const merged = [...first.results];
    const seenRows = new Set(merged.map((r) => r.caseUid ?? r.caseNumber));
    for (const pageHtml of pages.slice(1)) {
      for (const r of parseSearchResults(pageHtml, court.name, cat.label).results) {
        const key = r.caseUid ?? r.caseNumber;
        if (seenRows.has(key)) continue;
        seenRows.add(key);
        merged.push(r);
      }
    }

    return {
      court: court.name,
      category: cat.label,
      total: first.total > merged.length ? first.total : merged.length,
      results: merged,
    };
  }

  // HTTP-path pagination: follow page=2..N GET links (no captcha) in a BFS,
  // re-reading the sliding pagination window from each fetched page.
  private async paginateHttp(
    subdomain: string,
    firstHtml: string,
    preferHttp: boolean,
    maxPages: number,
  ): Promise<string[]> {
    const out: string[] = [];
    const visited = new Set<string>();
    const queue: string[] = [];
    const enqueue = (html: string) => {
      for (const href of extractPaginationHrefs(html)) {
        if (!visited.has(href) && !queue.includes(href)) queue.push(href);
      }
    };
    enqueue(firstHtml);
    while (queue.length && out.length + 1 < maxPages) {
      const href = queue.shift()!;
      visited.add(href);
      const path = href.startsWith("http") ? new URL(href).pathname + new URL(href).search : href;
      try {
        const res = await fetchSudrf({ subdomain, path, preferHttp });
        if (!/case_id=/i.test(res.html)) continue;
        out.push(res.html);
        enqueue(res.html);
      } catch {
        continue;
      }
    }
    return out;
  }

  // Convenience: list all known categories.
  listCategories(): CaseCategory[] {
    return CASE_CATEGORIES;
  }

  // Case detail card. The detail page has no captcha, so we can fetch it via
  // plain HTTP (fast). Falls back to the browser session if antibot blocks.
  async getCaseDetails(courtQuery: string, caseUrl: string): Promise<CaseDetails> {
    const court = this.resolveCourt(courtQuery);
    const path = caseUrl.startsWith("http") ? new URL(caseUrl).pathname + new URL(caseUrl).search : caseUrl;
    let html: string;
    try {
      const res = await fetchSudrf({ subdomain: court.subdomain, path, preferHttp: court.http });
      if (res.status === 429 || /429\s*Too Many Requests/i.test(res.html)) {
        throw new Error(`HTTP 429 rate limited (${court.subdomain})`);
      }
      html = res.html;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/429/.test(msg)) throw e;
      // antibot challenge → use the browser session
      html = await this.scraper_().getCasePage(court.subdomain, path, court.http);
    }
    if (/429\s*Too Many Requests/i.test(html) || (!/#cont1|id=['"]cont1['"]/i.test(html) && !/категория|уникальный идентификатор/i.test(html))) {
      throw new Error(`empty/blocked case card (${court.subdomain})`);
    }
    return parseCaseDetails(html, court.name, caseUrl);
  }

  // Build the search params for inspection/debugging without firing a request.
  explainParams(categoryDeloId: number, filters: SearchFilters): Record<string, string> {
    const cat = categoryByDeloId(categoryDeloId);
    if (!cat) throw new Error(`Unknown delo_id ${categoryDeloId}`);
    return buildSearchParams(cat, filters);
  }
}

// Re-exports for the MCP layer.
export { courtBaseUrl, CASE_CATEGORIES };
export type { CaseCategory, SearchFilters, CourtEntry };
