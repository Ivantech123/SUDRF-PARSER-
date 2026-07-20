// Thin fetch wrapper for the /api/* backend. Cookies are sent automatically
// (same-origin in dev via Vite proxy, in prod via reverse-proxy), so no
// Authorization header is needed here — the session cookie authenticates.

export interface ApiUser {
  id: string;
  email: string;
  role: "admin" | "user";
  createdAt: string;
    profile?: {
    firstName: string;
    lastName: string;
    patronymic?: string;
    city?: string;
    company?: string;
    bio?: string;
    participantRole?: "lawyer" | "judge" | "other";
    participantRoleChangedAt?: string;
  };
}

export interface ApiKey {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt?: string;
  token?: string; // only present right after creation
}

async function req(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  return res;
}

export async function getMe(): Promise<ApiUser | null> {
  const res = await req("/api/me");
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`/api/me ${res.status}`);
  const data = (await res.json()) as { user: ApiUser };
  return data.user;
}

export async function submitWaitlist(body: {
  email: string;
  name?: string;
  note?: string;
  consent: boolean;
  privacyVersion?: string;
}): Promise<void> {
  const res = await req("/api/waitlist", { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error ?? `waitlist failed (${res.status})`);
  }
}

export async function register(body: {
  token: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  patronymic?: string;
  city?: string;
  company?: string;
  bio?: string;
  participantRole?: "lawyer" | "judge" | "other";
}): Promise<ApiUser> {
  const res = await req("/api/register", { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error ?? `register failed (${res.status})`);
  }
  return ((await res.json()) as { user: ApiUser }).user;
}

export async function updateProfile(patch: Partial<NonNullable<ApiUser["profile"]>>): Promise<ApiUser> {
  const res = await req("/api/profile", { method: "PATCH", body: JSON.stringify(patch) });
  if (res.status === 429) {
    const e = (await res.json().catch(() => ({}))) as { error?: string; nextChangeAt?: string };
    throw new Error(
      e.nextChangeAt
        ? `${e.error ?? "Роль можно менять раз в месяц"}. Следующая смена: ${new Date(e.nextChangeAt).toLocaleDateString("ru-RU")}`
        : (e.error ?? "Роль можно менять раз в месяц"),
    );
  }
  if (!res.ok) throw new Error(`/api/profile ${res.status}`);
  return ((await res.json()) as { user: ApiUser }).user;
}

export interface InviteInfo {
  id: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  url: string;
}

export async function listInvites(): Promise<{ invites: InviteInfo[]; remaining: number; limitPerWeek: number }> {
  const res = await req("/api/invites");
  if (!res.ok) throw new Error(`/api/invites ${res.status}`);
  return (await res.json()) as { invites: InviteInfo[]; remaining: number; limitPerWeek: number };
}

export async function createInvite(): Promise<{ invite: { url: string; expiresAt: string }; remaining: number }> {
  const res = await req("/api/invites", { method: "POST", body: "{}" });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error ?? `create invite failed (${res.status})`);
  }
  return (await res.json()) as { invite: { url: string; expiresAt: string }; remaining: number };
}

export async function login(email: string, password: string): Promise<ApiUser> {
  const res = await req("/api/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error ?? `login failed (${res.status})`);
  }
  return ((await res.json()) as { user: ApiUser }).user;
}

export async function logout(): Promise<void> {
  await req("/api/logout", { method: "POST" });
}

export async function listKeys(): Promise<{ keys: ApiKey[]; mcpEndpoint: string }> {
  const res = await req("/api/keys");
  if (!res.ok) throw new Error(`/api/keys ${res.status}`);
  return (await res.json()) as { keys: ApiKey[]; mcpEndpoint: string };
}

export async function createKey(label: string): Promise<{ key: ApiKey; mcpEndpoint: string }> {
  const res = await req("/api/keys", {
    method: "POST",
    body: JSON.stringify({ label }),
  });
  if (!res.ok) throw new Error(`create key ${res.status}`);
  return (await res.json()) as { key: ApiKey; mcpEndpoint: string };
}

export async function deleteKey(id: string): Promise<void> {
  const res = await req(`/api/keys?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`delete key ${res.status}`);
}

// ── OAuth sessions: AI agents the user has authorized via the consent flow ─

export interface OAuthClientView {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  scope: string;
  createdAt: string;
}

export interface OAuthTokenView {
  clientId: string;
  scope: string;
  createdAt: string;
  expiresAt: string;
  fingerprint: string;
}

export async function listOAuthSessions(): Promise<{
  clients: OAuthClientView[];
  tokens: OAuthTokenView[];
  mcpEndpoint: string;
}> {
  const res = await req("/api/oauth/sessions");
  if (!res.ok) throw new Error(`/api/oauth/sessions ${res.status}`);
  return await res.json();
}

export async function disconnectOAuthClient(clientId: string): Promise<void> {
  const res = await req(`/api/oauth/sessions?clientId=${encodeURIComponent(clientId)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`disconnect ${res.status}`);
}

// ── Admin: invite-only user management ──────────────────────────────────

export interface AdminUser {
  id: string;
  email: string;
  role: "admin" | "user";
  createdAt: string;
  keys: number;
}

export async function adminListUsers(): Promise<AdminUser[]> {
  const res = await req("/api/admin/users");
  if (res.status === 403) throw new Error("нет прав — только для администратора");
  if (!res.ok) throw new Error(`/api/admin/users ${res.status}`);
  return ((await res.json()) as { users: AdminUser[] }).users;
}

export async function adminInviteUser(
  email: string,
  password: string,
  role: "admin" | "user" = "user"
): Promise<ApiUser> {
  const res = await req("/api/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password, role }),
  });
  if (res.status === 403) throw new Error("нет прав — только для администратора");
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error ?? `invite failed (${res.status})`);
  }
  return ((await res.json()) as { user: ApiUser }).user;
}

export interface WaitlistEntry {
  id: string;
  email: string;
  name: string;
  note: string;
  createdAt: string;
}

export async function adminListWaitlist(): Promise<{
  entries: WaitlistEntry[];
  smtpReady: boolean;
  note: string;
}> {
  const res = await req("/api/admin/waitlist");
  if (res.status === 403) throw new Error("нет прав — только для администратора");
  if (!res.ok) throw new Error(`/api/admin/waitlist ${res.status}`);
  return (await res.json()) as { entries: WaitlistEntry[]; smtpReady: boolean; note: string };
}

export async function adminDeleteUser(id: string): Promise<void> {
  const res = await req(`/api/admin/users?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  if (res.status === 403) throw new Error("нет прав — только для администратора");
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error ?? `delete failed (${res.status})`);
  }
}

// ── Cases & parser (cabinet session auth) ───────────────────────────────

export interface StoredDocument {
  docId: string;
  name: string;
  date?: string;
  caseNumber?: string;
  url?: string;
  text?: string;
  hasText?: boolean;
}

export interface StoredCase {
  id: string;
  caseUid?: string;
  caseNumber: string;
  courtSubdomain: string;
  courtName: string;
  courtRegion?: string;
  category: string;
  parties?: string;
  plaintiff?: string;
  defendant?: string;
  judge?: string;
  status?: string;
  entryDate?: string;
  resultDate?: string;
  hearingDate?: string;
  hearingTime?: string;
  courtroom?: string;
  caseUrl?: string;
  documentsCount: number;
  hasActText: boolean;
  documents?: StoredDocument[];
  eventsCount?: number;
  firstInstance?: {
    court?: string;
    caseNumber?: string;
    judge?: string;
  };
  participants?: Array<{ role: string; name: string; inn?: string }>;
  events?: Array<{
    date?: string;
    time?: string;
    name: string;
    result?: string;
    basis?: string;
    note?: string;
    courtroom?: string;
    publishDate?: string;
  }>;
  collectedAt: string;
  enrichedAt?: string;
}

export interface CourtFacet {
  subdomain: string;
  name: string;
  region?: string;
  count: number;
}

export interface CategoryFacet {
  name: string;
  count: number;
}

export interface RegionFacet {
  region: string;
  count: number;
}

export async function searchCases(opts: {
  caseNumber?: string;
  uid?: string;
  participant?: string;
  participantRole?: string;
  judge?: string;
  court?: string;
  region?: string;
  category?: string;
  categoryGroup?: string;
  hasDocuments?: boolean;
  enriched?: boolean;
  hearingFrom?: string;
  hearingTo?: string;
  limit?: number;
  offset?: number;
}): Promise<{ total: number; cases: StoredCase[] }> {
  const p = new URLSearchParams();
  if (opts.caseNumber?.trim()) p.set("caseNumber", opts.caseNumber.trim());
  if (opts.uid?.trim()) p.set("uid", opts.uid.trim());
  if (opts.participant?.trim()) p.set("participant", opts.participant.trim());
  if (opts.participantRole?.trim() && opts.participantRole !== "all") {
    p.set("participantRole", opts.participantRole.trim());
  }
  if (opts.judge?.trim()) p.set("judge", opts.judge.trim());
  if (opts.court && opts.court !== "all") p.set("court", opts.court);
  if (opts.region && opts.region !== "all") p.set("region", opts.region);
  if (opts.category && opts.category !== "all") p.set("category", opts.category);
  if (opts.categoryGroup && opts.categoryGroup !== "all") p.set("categoryGroup", opts.categoryGroup);
  if (opts.hasDocuments) p.set("hasDocuments", "1");
  if (opts.enriched) p.set("enriched", "1");
  if (opts.hearingFrom?.trim()) p.set("hearingFrom", opts.hearingFrom.trim());
  if (opts.hearingTo?.trim()) p.set("hearingTo", opts.hearingTo.trim());
  if (opts.limit) p.set("limit", String(opts.limit));
  if (opts.offset) p.set("offset", String(opts.offset));
  const qs = p.toString();
  const res = await req(`/api/cases${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`/api/cases ${res.status}`);
  return (await res.json()) as { total: number; cases: StoredCase[] };
}

export async function getCaseDetail(id: string): Promise<StoredCase> {
  const res = await req(`/api/cases/detail?id=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`/api/cases/detail ${res.status}`);
  return ((await res.json()) as { case: StoredCase }).case;
}

export interface CaseDocumentView {
  docId: string;
  name: string;
  date?: string;
  caseNumber?: string;
  url?: string;
  text: string | null;
  source?: "catalog" | "sudrf" | "rag" | "file";
  downloadUrl?: string;
}

export async function getCaseDocument(
  caseId: string,
  docId: string,
): Promise<{ document: CaseDocumentView; case: { id: string; caseNumber: string; courtSubdomain: string; caseUrl?: string } }> {
  const res = await req(
    `/api/cases/document?caseId=${encodeURIComponent(caseId)}&docId=${encodeURIComponent(docId)}`,
  );
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error ?? `document fetch failed (${res.status})`);
  }
  return (await res.json()) as {
    document: CaseDocumentView;
    case: { id: string; caseNumber: string; courtSubdomain: string; caseUrl?: string };
  };
}

export async function listCaseCourts(): Promise<CourtFacet[]> {
  const res = await req("/api/cases/courts");
  if (!res.ok) throw new Error(`/api/cases/courts ${res.status}`);
  return ((await res.json()) as { courts: CourtFacet[] }).courts;
}

export async function listCaseCategories(): Promise<CategoryFacet[]> {
  const res = await req("/api/cases/categories");
  if (!res.ok) throw new Error(`/api/cases/categories ${res.status}`);
  const data = (await res.json()) as { categories: CategoryFacet[] | string[] };
  const cats = data.categories;
  if (!cats.length) return [];
  if (typeof cats[0] === "string") {
    return (cats as string[]).map((name) => ({ name, count: 0 }));
  }
  return cats as CategoryFacet[];
}

export async function listCaseRegions(): Promise<RegionFacet[]> {
  const res = await req("/api/cases/regions");
  if (!res.ok) throw new Error(`/api/cases/regions ${res.status}`);
  return ((await res.json()) as { regions: RegionFacet[] }).regions;
}

export interface ParserTask {
  court: string;
  lastParsed: string;
  casesFound: number;
  casesParsed: number;
  nextScheduled: string;
}

export interface ParserStats {
  totalParsed: number;
  totalFailed: number;
  totalEnriched: number;
  totalDocuments?: number;
  catalogSize: number;
  enrichPending?: number;
  withDocuments?: number;
  withActText?: number;
  lastUpdate: string;
  running?: boolean;
  tasks: ParserTask[];
  collectionRate?: CollectionRateStats;
  displayRegion?: string;
  displayRegionLabel?: string;
}

export interface CollectionRateStats {
  newLast24h: number;
  newLast7d: number;
  perDay7d: number;
  etaDaysToTarget: number | null;
  targetCatalogSize: number;
  generatedAt: string;
}

export async function getParserStats(): Promise<ParserStats> {
  const res = await req("/api/parser/stats");
  if (!res.ok) throw new Error(`/api/parser/stats ${res.status}`);
  return (await res.json()) as ParserStats;
}

export interface CoverageStats {
  totals: {
    catalogSize: number;
    withCaseUrl: number;
    enriched: number;
    withDocuments: number;
    withActText: number;
    withFullText: number;
    enrichPending: number;
    inRag: number;
    ragChunks: number;
    ragCases: number;
  };
  rates: {
    enrichedPct: number;
    withDocumentsPct: number;
    withActTextPct: number;
    inRagPct: number;
    fullTextPct: number;
  };
  funnel: Array<{ stage: string; label: string; count: number; pct: number }>;
  byRegion: Array<{
    region: string;
    total: number;
    enriched: number;
    withDocuments: number;
    withActText: number;
    inRag: number;
    enrichPending: number;
  }>;
  byCourt: Array<{
    subdomain: string;
    name: string;
    region?: string;
    total: number;
    enriched: number;
    withDocuments: number;
    withActText: number;
    inRag: number;
  }>;
  collectionRate?: CollectionRateStats;
  generatedAt: string;
}

export async function getCoverageStats(): Promise<CoverageStats> {
  const res = await req("/api/analytics/coverage");
  if (!res.ok) throw new Error(`/api/analytics/coverage ${res.status}`);
  return (await res.json()) as CoverageStats;
}

export interface MordoviaCourtHeatCell {
  subdomain: string;
  name: string;
  total: number;
  enriched: number;
  withActText: number;
  firstInstance: number;
  appealLike: number;
  identifiableReps: number;
  intensity: number;
}

export interface MordoviaDashboard {
  generatedAt: string;
  region: string;
  regionLabel: string;
  totals: {
    catalog: number;
    enriched: number;
    withActText: number;
    withDocuments: number;
    firstInstance: number;
    appealLike: number;
    pendingEnrich: number;
  };
  prefixes: Record<string, number>;
  outcomes: {
    allEnriched: { total: number; known: number; byLabel: Record<string, number> };
    firstInstance: { total: number; known: number; byLabel: Record<string, number> };
  };
  depersonalization: {
    allEnriched: {
      sampleSize: number;
      withActText: number;
      withRepresentativeSignal: number;
      identifiable: number;
      onlyDepersonalized: number;
      noRepresentative: number;
      identifiableRate: number | null;
      goNoGo: string;
    };
    firstInstance: {
      sampleSize: number;
      withActText: number;
      withRepresentativeSignal: number;
      identifiable: number;
      onlyDepersonalized: number;
      noRepresentative: number;
      identifiableRate: number | null;
      goNoGo: string;
    };
  };
  courtHeatmap: MordoviaCourtHeatCell[];
  topCategories: Array<{ name: string; count: number }>;
  topJudges: Array<{ name: string; cases: number }>;
  professionals: { lawyers: number; judges: number; indexReady: boolean };
  winrate: {
    totalCases: number;
    withIdentifiableRep: number;
    withKnownOutcome: number;
    caveat: string;
    leaders: Array<{
      name: string;
      cases: number;
      wins: number;
      losses: number;
      neutrals: number;
      winRate: number | null;
      sampleCaseNumbers: string[];
    }>;
  };
  deep: {
    judges: Array<{
      name: string;
      cases: number;
      withDuration: number;
      medianDays: number | null;
      p75Days: number | null;
      knownOutcomes: number;
      plaintiffFavorable: number;
      denied: number;
      plaintiffFavorRate: number | null;
      bankCases: number;
      bankFavorable: number;
      bankFavorRate: number | null;
      appealReviewed: number;
      appealChanged: number;
      appealChangeRate: number | null;
      intensity: number;
    }>;
    seasonality: Array<{
      month: number;
      label: string;
      total: number;
      communal: number;
      divorce: number;
      dtp: number;
      credit: number;
      other: number;
    }>;
    lifecycle: {
      sampleSize: number;
      medianDays: number | null;
      p25Days: number | null;
      p75Days: number | null;
      meanDays: number | null;
    };
    amounts: {
      casesWithClaim: number;
      casesWithAward: number;
      casesWithBoth: number;
      medianClaim: number | null;
      medianAward: number | null;
      medianConversion: number | null;
      totalClaim: number;
      totalAward: number;
    };
    serialPlaintiffs: Array<{
      name: string;
      cases: number;
      knownOutcomes: number;
      wins: number;
      losses: number;
      winRate: number | null;
      kind: "bank" | "uk" | "insurance" | "other";
      sampleCaseNumbers: string[];
    }>;
    stuckUnknown: Array<{
      caseNumber: string;
      court: string;
      judge?: string;
      entryDate?: string;
      ageDays: number | null;
      status?: string;
      hasActText: boolean;
    }>;
    practiceShift: Array<{
      ym: string;
      total: number;
      known: number;
      granted: number;
      denied: number;
      grantedRate: number | null;
    }>;
    notes: string[];
  };
  participants: {
    representatives: number;
    plaintiffs: number;
    defendants: number;
    third: number;
    topRepresentatives: Array<{ name: string; cases: number; courts: number; withActs: number }>;
  };
  repHeatmaps?: {
    byCourt: Array<{
      subdomain: string;
      name: string;
      appearances: number;
      uniquePeople: number;
      bySubtype: Record<
        "representative" | "advocate" | "jurist",
        { appearances: number; uniquePeople: number }
      >;
      intensity: number;
    }>;
    matrix: {
      people: Array<{
        id: string;
        name: string;
        total: number;
        bySubtype: Partial<Record<"representative" | "advocate" | "jurist", number>>;
      }>;
      courts: Array<{ subdomain: string; shortName: string }>;
      grid: number[][];
    };
    totals: {
      appearances: number;
      uniquePeople: number;
      bySubtype: Record<
        "representative" | "advocate" | "jurist",
        { appearances: number; uniquePeople: number }
      >;
    };
    notes: string[];
  };
  recentEnriched: Array<{
    caseNumber: string;
    court: string;
    status?: string;
    hasActText: boolean;
    enrichedAt?: string;
  }>;
}

export async function getMordoviaAnalytics(): Promise<MordoviaDashboard> {
  const res = await req("/api/analytics/mordovia");
  if (!res.ok) throw new Error(`/api/analytics/mordovia ${res.status}`);
  return (await res.json()) as MordoviaDashboard;
}

export interface AiInsightResult {
  markdown: string;
  model: string;
  generatedAt: string;
}

export async function requestMordoviaInsights(): Promise<AiInsightResult> {
  const res = await req("/api/analytics/insights", { method: "POST" });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error ?? `/api/analytics/insights ${res.status}`);
  }
  return (await res.json()) as AiInsightResult;
}

export type CardAiKind = "lawyer" | "participant";
export type CardAiMode = "profile" | "hints" | "brief";

export interface CardAiResult {
  markdown: string;
  model: string;
  generatedAt: string;
  mode: CardAiMode;
  kind: CardAiKind;
}

export async function requestCardAi(opts: {
  kind: CardAiKind;
  mode: CardAiMode;
  id?: string;
  name?: string;
  role?: string;
}): Promise<CardAiResult> {
  const res = await req("/api/ai/card", {
    method: "POST",
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error ?? `/api/ai/card ${res.status}`);
  }
  return (await res.json()) as CardAiResult;
}

export interface ParticipantPerson {
  id: string;
  name: string;
  roles: string[];
  families: string[];
  primaryFamily: string;
  cases: number;
  courts: number;
  withActs: number;
  enrichedCases: number;
  sampleCaseNumbers: string[];
  sampleCourts: string[];
}

export interface ParticipantRoleFacet {
  family: string;
  label: string;
  people: number;
  appearances: number;
}

export async function searchParticipants(opts: {
  q?: string;
  role?: string;
  limit?: number;
  offset?: number;
  minCases?: number;
}): Promise<{
  total: number;
  indexReady: boolean;
  facets: ParticipantRoleFacet[];
  people: ParticipantPerson[];
  roleLabels?: Record<string, string>;
}> {
  const p = new URLSearchParams();
  if (opts.q?.trim()) p.set("q", opts.q.trim());
  if (opts.role?.trim() && opts.role !== "all") p.set("role", opts.role.trim());
  if (opts.limit) p.set("limit", String(opts.limit));
  if (opts.offset) p.set("offset", String(opts.offset));
  if (opts.minCases) p.set("minCases", String(opts.minCases));
  const res = await req(`/api/participants?${p}`);
  if (!res.ok) throw new Error(`/api/participants ${res.status}`);
  return (await res.json()) as {
    total: number;
    indexReady: boolean;
    facets: ParticipantRoleFacet[];
    people: ParticipantPerson[];
    roleLabels?: Record<string, string>;
  };
}

export interface ParticipantDossier {
  person: ParticipantPerson;
  rating: number;
  tier: "gold" | "silver" | "bronze" | "common";
  roleLabel: string;
  stats: {
    cases: number;
    courts: number;
    withActs: number;
    enrichedCases: number;
    knownOutcomes: number;
    wins: number;
    losses: number;
    neutrals: number;
    winRate: number | null;
    medianDays: number | null;
  };
  outcomes: Record<string, number>;
  byCourt: Array<{ subdomain: string; name: string; count: number }>;
  byCategory: Array<{ name: string; count: number }>;
  byYear: Array<{ year: string; count: number }>;
  geoHeat?: Array<{ region: string; label: string; cases: number }>;
  ratingFactors?: Array<{ key: string; label: string; score: number; max: number }>;
  cases: Array<{
    id: string;
    caseNumber: string;
    courtSubdomain: string;
    courtName: string;
    category: string;
    status?: string;
    roleOnCase: string;
    hasActText: boolean;
    enriched: boolean;
    outcome: string;
    entryDate?: string;
    resultDate?: string;
    judge?: string;
  }>;
  caveat: string;
}

export async function getParticipantDossier(opts: {
  id?: string;
  name?: string;
  role?: string;
}): Promise<ParticipantDossier> {
  const p = new URLSearchParams();
  if (opts.id) p.set("id", opts.id);
  if (opts.name?.trim()) p.set("name", opts.name.trim());
  if (opts.role?.trim()) p.set("role", opts.role.trim());
  const res = await req(`/api/participants/detail?${p}`);
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error ?? `/api/participants/detail ${res.status}`);
  }
  return ((await res.json()) as { dossier: ParticipantDossier }).dossier;
}

export async function triggerParser(court: string): Promise<{ collected: number; enriched: number; documents?: number; errors: string[] }> {
  const res = await req("/api/parser/trigger", {
    method: "POST",
    body: JSON.stringify({ court }),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error ?? `parser trigger failed (${res.status})`);
  }
  return (await res.json()) as { collected: number; enriched: number; documents?: number; errors: string[] };
}

export async function triggerDocumentEnrich(limit = 30): Promise<{ enriched: number; documents: number; errors: string[] }> {
  const res = await req("/api/parser/enrich", {
    method: "POST",
    body: JSON.stringify({ limit }),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error ?? `parser enrich failed (${res.status})`);
  }
  return (await res.json()) as { enriched: number; documents: number; errors: string[] };
}

// ── Lawyers (FIFA cards) ────────────────────────────────────────────────

export interface LawyerCardStats {
  cases: number;
  courts: number;
  documents: number;
  categories: number;
  enrichedCases: number;
  regions: number;
  civilCases: number;
  criminalCases: number;
  withActs: number;
  lastActive?: string;
}

export interface LawyerHeatmapCell {
  region: string;
  label: string;
  lawyers: number;
  judges: number;
  total: number;
  caseCount?: number;
}

export interface LawyerCard {
  id: string;
  name: string;
  roles: string[];
  primaryRole: string;
  roleLabel: string;
  rating: number;
  tier: "gold" | "silver" | "bronze" | "common";
  stats: LawyerCardStats;
  mainCourt: string;
  mainCourtSubdomain: string;
  region?: string;
  regions: string[];
  categories: string[];
  caseIds: string[];
  ratingFactors?: Array<{ key: string; label: string; score: number; max: number }>;
  geoHeat?: Array<{ region: string; label: string; cases: number }>;
  courtHeat?: Array<{ subdomain: string; name: string; cases: number }>;
  categoryHeat?: Array<{ name: string; count: number }>;
  judgePractice?: {
    medianDays: number | null;
    p75Days: number | null;
    withDuration: number;
    knownOutcomes: number;
    plaintiffFavorable: number;
    denied: number;
    plaintiffFavorRate: number | null;
    appealReviewed: number;
    appealChanged: number;
    appealChangeRate: number | null;
    bankCases: number;
    bankFavorable: number;
    bankFavorRate: number | null;
    firstInstance: number;
    appealLike: number;
    outcomes: Record<string, number>;
  };
  recentCases: Array<{
    id: string;
    caseNumber: string;
    courtName: string;
    category: string;
    status?: string;
    hearingDate?: string;
    hasDocuments?: boolean;
  }>;
}

export async function getMyPlayerCard(): Promise<
  | { status: "found"; card: LawyerCard; isLawyer: boolean; isJudge: boolean }
  | { status: "waiting"; participantRole: string; displayName: string; message: string }
  | { status: "need_profile"; message: string }
  | { status: "none"; message: string }
> {
  const res = await req("/api/me/player-card");
  if (!res.ok) throw new Error(`/api/me/player-card ${res.status}`);
  return (await res.json()) as Awaited<ReturnType<typeof getMyPlayerCard>>;
}

export async function listLawyers(opts: {
  q?: string;
  role?: string;
  limit?: number;
  offset?: number;
}): Promise<{ total: number; lawyers: LawyerCard[]; indexReady?: boolean }> {
  const p = new URLSearchParams();
  if (opts.q) p.set("q", opts.q);
  if (opts.role && opts.role !== "all") p.set("role", opts.role);
  if (opts.limit) p.set("limit", String(opts.limit));
  if (opts.offset) p.set("offset", String(opts.offset));
  const qs = p.toString();
  const res = await req(`/api/lawyers${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`/api/lawyers ${res.status}`);
  return (await res.json()) as { total: number; lawyers: LawyerCard[]; indexReady?: boolean };
}

export async function getLawyerDetail(id: string): Promise<LawyerCard> {
  const res = await req(`/api/lawyers/detail?id=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`/api/lawyers/detail ${res.status}`);
  return ((await res.json()) as { lawyer: LawyerCard }).lawyer;
}

export async function getLawyerHeatmap(role?: "lawyer" | "judge"): Promise<{
  cells: LawyerHeatmapCell[];
  mode: "professionals" | "cases";
  indexReady?: boolean;
}> {
  const qs = role ? `?role=${role}` : "";
  const res = await req(`/api/lawyers/heatmap${qs}`);
  if (!res.ok) throw new Error(`/api/lawyers/heatmap ${res.status}`);
  return (await res.json()) as {
    cells: LawyerHeatmapCell[];
    mode: "professionals" | "cases";
    indexReady?: boolean;
  };
}

export async function searchParticipant(body: {
  name: string;
  region?: string;
  deepSearch?: boolean;
}): Promise<{
  summary?: string;
  deepSearch?: { jobId: string; status: string };
}> {
  const res = await req("/api/participant/search", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`/api/participant/search ${res.status}`);
  return (await res.json()) as { summary?: string; deepSearch?: { jobId: string; status: string } };
}

export async function getParticipantSearch(jobId: string): Promise<{ status: string; resultsCount?: number }> {
  const res = await req(`/api/participant/search?jobId=${encodeURIComponent(jobId)}`);
  if (!res.ok) throw new Error(`/api/participant/search ${res.status}`);
  return (await res.json()) as { status: string; resultsCount?: number };
}
