// TypeScript client example for sudrf-mcp REST API.
// Install: npm install node-fetch (for Node.js < 18)

import type {
  CaseCategory,
  CourtEntry,
  HearingScheduleRequest,
  HearingScheduleResponse,
  SearchCasesRequest,
  SearchCasesResponse,
  CaseDetailsRequest,
  CaseDetailsResponse,
  IndexCaseRequest,
  IndexCaseResponse,
  SearchCaseTextsRequest,
  SearchCaseTextsResponse,
  ListIndexedCasesResponse,
  RemoveCaseRequest,
  RemoveCaseResponse,
  ApiError,
} from "../src/api/types.js";

export class SudrfRestClient {
  constructor(
    private baseUrl: string,
    private token: string
  ) {}

  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}/${endpoint}`;
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${this.token}`,
    };

    const opts: RequestInit = { method, headers };

    if (body) {
      headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(url, opts);
    const data = await res.json();

    if (!res.ok) {
      const error = data as ApiError;
      throw new Error(`HTTP ${res.status}: ${error.error}`);
    }

    return data as T;
  }

  // ── Tools ──────────────────────────────────────────────────────────────

  async listCaseCategories(): Promise<CaseCategory[]> {
    return this.request<CaseCategory[]>("GET", "list_case_categories");
  }

  async resolveCourt(query: string): Promise<CourtEntry> {
    return this.request<CourtEntry>("POST", "resolve_court", { query });
  }

  async getHearingSchedule(
    req: HearingScheduleRequest
  ): Promise<HearingScheduleResponse> {
    return this.request<HearingScheduleResponse>(
      "POST",
      "get_hearing_schedule",
      req
    );
  }

  async searchCases(req: SearchCasesRequest): Promise<SearchCasesResponse> {
    return this.request<SearchCasesResponse>("POST", "search_cases", req);
  }

  async getCaseDetails(
    req: CaseDetailsRequest
  ): Promise<CaseDetailsResponse> {
    return this.request<CaseDetailsResponse>("POST", "get_case_details", req);
  }

  async indexCase(req: IndexCaseRequest): Promise<IndexCaseResponse> {
    return this.request<IndexCaseResponse>("POST", "index_case", req);
  }

  async searchCaseTexts(
    req: SearchCaseTextsRequest
  ): Promise<SearchCaseTextsResponse> {
    return this.request<SearchCaseTextsResponse>(
      "POST",
      "search_case_texts",
      req
    );
  }

  async listIndexedCases(): Promise<ListIndexedCasesResponse> {
    return this.request<ListIndexedCasesResponse>("GET", "list_indexed_cases");
  }

  async removeCase(req: RemoveCaseRequest): Promise<RemoveCaseResponse> {
    return this.request<RemoveCaseResponse>("POST", "remove_case", req);
  }
}

// ── Example usage ────────────────────────────────────────────────────────

async function example() {
  const client = new SudrfRestClient(
    "http://localhost:8080/rest",
    process.env.TOKEN || ""
  );

  // 1. List categories
  const categories = await client.listCaseCategories();
  console.log("Categories:", categories.length);

  // 2. Resolve court
  const court = await client.resolveCourt("Мордовия");
  console.log("Court:", court.subdomain, "-", court.name);

  // 3. Get today's hearings
  const today = new Date();
  const date = `${String(today.getDate()).padStart(2, "0")}.${String(today.getMonth() + 1).padStart(2, "0")}.${today.getFullYear()}`;
  const schedule = await client.getHearingSchedule({
    court: court.subdomain,
    date,
  });
  console.log(`Hearings on ${date}:`, schedule.count);

  // 4. Search civil cases
  const civilCat = categories.find((c) => c.name === "CIVIL");
  if (civilCat) {
    const cases = await client.searchCases({
      court: court.subdomain,
      delo_id: civilCat.id,
      entryDateFrom: "01.01.2024",
      entryDateTo: "31.12.2024",
    });
    console.log(`Civil cases found:`, cases.total);

    // 5. Get details for first case
    if (cases.results.length > 0 && cases.results[0].caseUrl) {
      const details = await client.getCaseDetails({
        court: court.subdomain,
        caseUrl: cases.results[0].caseUrl,
        includeDocumentText: false, // metadata only
      });
      console.log(`Case ${details.caseNumber}:`);
      console.log(`  Category: ${details.category}`);
      console.log(`  Events: ${details.events.length}`);
      console.log(`  Documents: ${details.documents.length}`);

      // 6. Index the case
      const indexed = await client.indexCase({
        court: court.subdomain,
        caseUrl: cases.results[0].caseUrl,
      });
      console.log(`Indexed: ${indexed.chunksAdded} chunks added`);
    }
  }

  // 7. Search case texts
  const corpus = await client.listIndexedCases();
  console.log(`Corpus: ${corpus.corpusSize} chunks, ${corpus.caseCount} cases`);

  if (corpus.caseCount > 0) {
    const textSearch = await client.searchCaseTexts({
      query: "срок исковой давности",
      limit: 5,
    });
    console.log(`Text search: ${textSearch.total} hits`);
    if (textSearch.hits.length > 0) {
      const hit = textSearch.hits[0];
      console.log(`  Top hit (score ${hit.score}):`);
      console.log(`    ${hit.caseNumber} - ${hit.court}`);
      console.log(`    ${hit.actType} (${hit.actDate})`);
    }
  }
}

// Run example if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  example().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}
