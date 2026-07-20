// TypeScript types for REST API request/response payloads.
// Use these types when building a TypeScript client for the REST API.

// ── Request types ────────────────────────────────────────────────────────

export interface ResolveCourtRequest {
  query: string;
}

export interface HearingScheduleRequest {
  court: string;
  date: string; // DD.MM.YYYY
}

export interface SearchCasesRequest {
  court: string;
  delo_id: number;
  caseNumber?: string;
  uid?: string;
  participantName?: string;
  inn?: string;
  kpp?: string;
  ogrn?: string;
  judge?: string;
  entryDateFrom?: string; // DD.MM.YYYY
  entryDateTo?: string;
  resultDateFrom?: string;
  resultDateTo?: string;
  lawArticle?: string;
}

export interface CaseDetailsRequest {
  court: string;
  caseUrl: string;
  includeDocumentText?: boolean;
}

export interface IndexCaseRequest {
  court: string;
  caseUrl: string;
  replace?: boolean;
}

export interface SearchCaseTextsRequest {
  query: string;
  limit?: number;
  court?: string;
  caseNumber?: string;
}

export interface RemoveCaseRequest {
  caseUid: string;
}

// ── Response types ───────────────────────────────────────────────────────

export interface CaseCategory {
  id: number;
  label: string;
  name: string;
  vnkod: number;
}

export interface CourtEntry {
  subdomain: string;
  name: string;
  region: string;
  type: string;
  vnkod: string;
  captcha: boolean;
  http: boolean;
}

export interface HearingItem {
  caseNumber: string;
  caseUid?: string;
  parties: string;
  category: string;
  judge: string;
  courtroom?: string;
  hearingTime?: string;
  hearingDate: string;
  caseUrl?: string;
}

export interface HearingScheduleResponse {
  court: string;
  date: string;
  count: number;
  items: HearingItem[];
}

export interface CaseSearchResult {
  caseNumber: string;
  caseUid?: string;
  category: string;
  plaintiff?: string;
  defendant?: string;
  judge?: string;
  entryDate?: string;
  resultDate?: string;
  status?: string;
  caseUrl?: string;
}

export interface SearchCasesResponse {
  court: string;
  category: string;
  total: number;
  results: CaseSearchResult[];
}

export interface CaseEvent {
  date?: string;
  time?: string;
  name: string;
  result?: string;
  basis?: string;
  note?: string;
  courtroom?: string;
  publishDate?: string;
}

export interface CaseParticipant {
  role: string;
  name: string;
  inn?: string;
  kpp?: string;
  ogrn?: string;
  ogrnip?: string;
}

export interface CaseDocument {
  docId: string;
  name: string;
  caseNumber?: string;
  date?: string;
  text?: string; // only if includeDocumentText=true
  url?: string;
}

export interface CaseDetailsResponse {
  caseNumber: string;
  caseUid?: string;
  category: string;
  court: string;
  plaintiff?: string;
  defendant?: string;
  judge?: string;
  entryDate?: string;
  resultDate?: string;
  status?: string;
  firstInstance?: {
    court?: string;
    caseNumber?: string;
    judge?: string;
  };
  participants: CaseParticipant[];
  events: CaseEvent[];
  documents: CaseDocument[];
  caseUrl?: string;
}

export interface IndexCaseResponse {
  caseUid?: string;
  caseNumber?: string;
  court: string;
  chunksAdded: number;
  alreadyIndexed: boolean;
  corpusSize: number;
  corpusCases: number;
}

export interface SearchCaseTextsHit {
  score: number;
  caseUid: string;
  caseNumber?: string;
  court?: string;
  actType?: string;
  actDate?: string;
  chunkIndex: number;
  text: string;
}

export interface SearchCaseTextsResponse {
  query: string;
  total: number;
  corpusSize: number;
  corpusCases: number;
  hits: SearchCaseTextsHit[];
}

export interface IndexedCaseInfo {
  caseUid: string;
  caseNumber?: string;
  court?: string;
  chunks: number;
}

export interface ListIndexedCasesResponse {
  corpusSize: number;
  caseCount: number;
  cases: IndexedCaseInfo[];
}

export interface RemoveCaseResponse {
  caseUid: string;
  chunksRemoved: number;
  corpusSize: number;
  corpusCases: number;
}

export interface ApiError {
  error: string;
}
