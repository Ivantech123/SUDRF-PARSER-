// Cases — browse collected court cases with search, filters, and full case cards.

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../lib/auth.js";
import {
  searchCases,
  getCaseDetail,
  getParticipantDossier,
  listCaseCourts,
  listCaseCategories,
  getParserStats,
  getCoverageStats,
  type StoredCase,
  type CourtFacet,
  type CategoryFacet,
  type ParserStats,
  type CoverageStats,
  type ParticipantDossier,
} from "../lib/api.js";
import {
  EMPTY_FILTERS,
  DISPLAY_REGION,
  hasActiveFilters,
  countActiveFilters,
  type CaseSearchFilters,
} from "../lib/case-filters.js";
import { navigate } from "./Router.js";
import CaseDetail from "./CaseDetail.js";
import CaseFiltersPanel from "./CaseFilters.js";
import CoveragePanel from "./CoveragePanel.js";
import ParticipantDossierModal from "./ParticipantDossier.js";
import ModalPortal from "./ModalPortal.js";

/** Mobile quick search → one field, smart target. */
function applyQuickSearch(q: string): Partial<CaseSearchFilters> {
  const t = q.trim();
  if (!t) {
    return { caseNumber: "", uid: "", participant: "", judge: "" };
  }
  if (/^\d[\dA-Za-zа-яА-ЯёЁ.\-\/]*$/.test(t) && (t.includes("/") || t.includes("-"))) {
    return { caseNumber: t, uid: "", participant: "", judge: "" };
  }
  if (/^[0-9a-fA-F-]{20,}$/.test(t.replace(/\s/g, ""))) {
    return { uid: t, caseNumber: "", participant: "", judge: "" };
  }
  return { participant: t, caseNumber: "", uid: "", judge: "" };
}

function quickSearchValue(f: CaseSearchFilters): string {
  return f.caseNumber || f.uid || f.participant || f.judge || "";
}

function roleFamilyFromRaw(role: string): string | undefined {
  const r = role.toLowerCase();
  if (/представ|адвокат|защитник|юрисконсульт/.test(r)) return "representative";
  if (/истец|заявител|взыскател/.test(r)) return "plaintiff";
  if (/ответчик|должник|обвиняем/.test(r)) return "defendant";
  if (/треть/.test(r)) return "third";
  if (/судья|председ/.test(r)) return "judge";
  return undefined;
}

const PAGE_SIZE = 30;

export default function Cases() {
  const { user } = useAuth();
  const [cases, setCases] = useState<StoredCase[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<ParserStats | null>(null);
  const [coverage, setCoverage] = useState<CoverageStats | null>(null);
  const [courts, setCourts] = useState<CourtFacet[]>([]);
  const [categories, setCategories] = useState<CategoryFacet[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<CaseSearchFilters>(EMPTY_FILTERS);
  const [debouncedFilters, setDebouncedFilters] = useState<CaseSearchFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<StoredCase | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [dossier, setDossier] = useState<ParticipantDossier | null>(null);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [caseFromDossier, setCaseFromDossier] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate("/login");
      return;
    }
    void listCaseCourts().then(setCourts).catch(() => {});
    void listCaseCategories().then(setCategories).catch(() => {});
  }, [user]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedFilters(filters), 350);
    return () => clearTimeout(t);
  }, [filters]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("casesPrefill");
      if (!raw) return;
      sessionStorage.removeItem("casesPrefill");
      const pre = JSON.parse(raw) as Partial<{ participant: string; participantRole: string }>;
      setFilters((f) => ({
        ...f,
        participant: pre.participant ?? f.participant,
        participantRole: pre.participantRole ?? f.participantRole,
      }));
      setPage(0);
    } catch { /* ignore */ }
  }, []);

  const loadCases = useCallback(async () => {
    setLoading(true);
    try {
      const data = await searchCases({
        caseNumber: debouncedFilters.caseNumber || undefined,
        uid: debouncedFilters.uid || undefined,
        participant: debouncedFilters.participant || undefined,
        participantRole: debouncedFilters.participantRole || undefined,
        judge: debouncedFilters.judge || undefined,
        court: debouncedFilters.court,
        region: debouncedFilters.region,
        category: debouncedFilters.category,
        categoryGroup: debouncedFilters.categoryGroup,
        hasDocuments: debouncedFilters.onlyWithDocuments || undefined,
        enriched: debouncedFilters.onlyEnriched || undefined,
        hearingFrom: debouncedFilters.hearingFrom || undefined,
        hearingTo: debouncedFilters.hearingTo || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setCases(data.cases);
      setTotal(data.total);
    } catch (e) {
      console.error("Failed to load cases:", e);
    } finally {
      setLoading(false);
    }
  }, [debouncedFilters, page]);

  const loadStats = useCallback(async () => {
    try {
      const [parserRes, covRes] = await Promise.allSettled([getParserStats(), getCoverageStats()]);
      if (parserRes.status === "fulfilled") setStats(parserRes.value);
      if (covRes.status === "fulfilled") setCoverage(covRes.value);
      if (parserRes.status === "rejected" && covRes.status === "rejected") {
        console.error("Failed to load stats:", parserRes.reason, covRes.reason);
      }
    } catch (e) {
      console.error("Failed to load stats:", e);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadCases();
  }, [user, loadCases]);

  const filtersIdle = useMemo(
    () => !hasActiveFilters(debouncedFilters) && page === 0,
    [debouncedFilters, page],
  );

  // Refresh case list when idle on first page (catalog grows in background)
  useEffect(() => {
    if (!user || !filtersIdle) return;
    const interval = setInterval(() => {
      void loadCases();
    }, 120_000);
    return () => clearInterval(interval);
  }, [user, filtersIdle, loadCases]);

  useEffect(() => {
    if (!user) return;
    void loadStats();
    const interval = setInterval(() => {
      void loadStats();
    }, 60_000);
    return () => clearInterval(interval);
  }, [user, loadStats]);

  useEffect(() => {
    setPage(0);
  }, [debouncedFilters]);

  const patchFilters = (patch: Partial<CaseSearchFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  };

  const resetFilters = () => setFilters(EMPTY_FILTERS);

  const openDetail = async (c: StoredCase) => {
    setDetailLoading(true);
    try {
      const full = await getCaseDetail(c.id);
      setDetail(full);
    } catch {
      setDetail(c);
    } finally {
      setDetailLoading(false);
    }
  };

  const openParticipant = async (p: { name: string; role: string }) => {
    setDossierLoading(true);
    try {
      const d = await getParticipantDossier({
        name: p.name,
        role: roleFamilyFromRaw(p.role),
      });
      setDossier(d);
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Карточка участника не найдена");
    } finally {
      setDossierLoading(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const kpi = useMemo(() => ({
    catalogSize: coverage?.totals.catalogSize ?? stats?.catalogSize ?? total,
    withDocuments: coverage?.totals.withDocuments ?? stats?.withDocuments ?? 0,
    enriched: coverage?.totals.enriched ?? stats?.totalEnriched ?? 0,
    enrichPending: coverage?.totals.enrichPending ?? stats?.enrichPending ?? 0,
  }), [coverage, stats, total]);

  const activeFilterCount = countActiveFilters(filters);

  if (!user) return null;

  const filterProps = {
    filters,
    onChange: patchFilters,
    onReset: resetFilters,
    courts,
    categories,
    loading,
    onRefresh: () => void loadCases(),
  };

  return (
    <main className="page-shell overflow-x-clip">
      <div className="mx-auto min-w-0 max-w-7xl">
        {/* —— Mobile: search + list —— */}
        <div className="md:hidden">
          <h1 className="font-display text-3xl text-white">Дела</h1>
          <p className="mt-1 font-mono text-[11px] text-white/40">
            Мордовия · {kpi.catalogSize.toLocaleString()} в каталоге
          </p>
          <div className="mt-4 flex gap-2">
            <input
              type="search"
              value={quickSearchValue(filters)}
              onChange={(e) => patchFilters(applyQuickSearch(e.target.value))}
              placeholder="Номер, УИД или ФИО"
              className="min-w-0 flex-1 border border-white/20 bg-black px-3 py-3 font-mono text-[13px] text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
            />
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className="shrink-0 border border-white/25 px-3 py-3 font-mono text-[10px] uppercase tracking-[0.12em] text-white/80"
            >
              Фильтры{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
            </button>
          </div>
        </div>

        {/* —— Desktop intro + KPI —— */}
        <div className="hidden md:block">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-white/40">ГАС Правосудие</p>
            <h1 className="mt-2 font-display text-4xl text-white sm:text-5xl">Дела судов РФ</h1>
            <p className="mt-2 font-mono text-[12px] text-sky-400/90">
              Республика Мордовия (регион {DISPLAY_REGION}) · каталог ~{kpi.catalogSize.toLocaleString()} дел · с 2010 года
            </p>
            <p className="mt-4 max-w-3xl font-mono text-[13px] leading-relaxed text-white/60">
              Поиск по номеру, УИД, участникам, судье и категории. Большая часть записей — из расписания заседаний;
              полные карточки и тексты актов появляются после догрузки. Фильтр «только с карточкой» отсекает заглушки.
              {stats?.running === true && (
                <span className="mt-2 block text-emerald-400/80">
                  ● Парсер работает — дела и документы собираются автоматически
                  {kpi.enrichPending > 0 && (
                    <span className="text-sky-400/80"> · в очереди документов: {kpi.enrichPending.toLocaleString()}</span>
                  )}
                </span>
              )}
            </p>
          </motion.div>

          <section className="mt-6 grid grid-cols-2 gap-3 sm:mt-8 sm:gap-4 lg:grid-cols-5">
            {[
              { label: "В каталоге", value: kpi.catalogSize, color: "text-white" },
              { label: "За 24 ч", value: stats?.collectionRate?.newLast24h ?? coverage?.collectionRate?.newLast24h ?? 0, color: "text-lime-400" },
              { label: "С документами", value: kpi.withDocuments, color: "text-sky-400" },
              { label: "С полными карточками", value: kpi.enriched, color: "text-emerald-400" },
              { label: "Очередь док.", value: kpi.enrichPending, color: "text-amber-400" },
            ].map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 * i }}
                className="border border-white/10 p-6"
              >
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">{s.label}</p>
                <p className={`mt-2 font-display text-4xl ${s.color}`}>{s.value.toLocaleString()}</p>
              </motion.div>
            ))}
          </section>

          {(stats?.collectionRate || coverage?.collectionRate) && (
            <p className="mt-3 font-mono text-[12px] text-white/45">
              Средняя скорость: {(stats?.collectionRate?.perDay7d ?? coverage?.collectionRate?.perDay7d ?? 0).toLocaleString()} дел/сутки (7 дн.) ·
              до ~500k (потолок Мордовии по расписанию):{" "}
              {(stats?.collectionRate?.etaDaysToTarget ?? coverage?.collectionRate?.etaDaysToTarget) != null
                ? `~${(stats?.collectionRate?.etaDaysToTarget ?? coverage?.collectionRate?.etaDaysToTarget)?.toLocaleString()} дн.`
                : "—"}
            </p>
          )}

          <CoveragePanel data={coverage} loading={!coverage && !!user} />
          <CaseFiltersPanel {...filterProps} />
        </div>

        <section className="mt-6 md:mt-8">
          <div className="mb-4 flex items-center justify-between">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
              Найдено: {total.toLocaleString()}
            </p>
            {totalPages > 1 && (
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-white/50">
                <button
                  type="button"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                  className="border border-white/20 px-2 py-1 disabled:opacity-30"
                >
                  ←
                </button>
                <label className="flex items-center gap-1.5">
                  <span className="text-white/35">стр.</span>
                  <input
                    type="number"
                    min={1}
                    max={totalPages}
                    value={page + 1}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isFinite(n)) return;
                      setPage(Math.max(0, Math.min(totalPages - 1, Math.floor(n) - 1)));
                    }}
                    className="w-16 border border-white/20 bg-black px-2 py-1 text-center text-white outline-none focus:border-amber-400/50"
                  />
                  <span>/ {totalPages.toLocaleString()}</span>
                </label>
                <button
                  type="button"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                  className="border border-white/20 px-2 py-1 disabled:opacity-30"
                >
                  →
                </button>
              </div>
            )}
          </div>

          {loading ? (
            <div className="flex min-h-[320px] items-center justify-center border border-white/10">
              <p className="font-mono text-sm text-white/40">Загрузка...</p>
            </div>
          ) : cases.length === 0 ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center border border-white/10 text-center">
              <p className="font-mono text-sm text-white/50">Дела не найдены</p>
              <p className="mt-2 max-w-md font-mono text-[11px] text-white/30">
                Уточните фильтры. Дела появляются из расписаний заседаний.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <AnimatePresence mode="popLayout">
                {cases.map((c, i) => (
                  <motion.button
                    key={c.id}
                    type="button"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.02, 0.2) }}
                    onClick={() => void openDetail(c)}
                    className="group min-w-0 overflow-hidden border border-white/10 p-5 text-left transition hover:border-white/35"
                  >
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <p className="min-w-0 font-mono text-lg text-white">{c.caseNumber}</p>
                        {c.enrichedAt ? (
                          <span className="shrink-0 border border-emerald-400/30 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-emerald-300/90">
                            карточка
                          </span>
                        ) : (
                          <span className="shrink-0 border border-white/15 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-white/35">
                            расписание
                          </span>
                        )}
                      </div>
                      <span className="min-w-0 font-mono text-[9px] uppercase tracking-wider text-white/40 line-clamp-2 break-words">
                        {c.status ?? (c.enrichedAt ? "—" : "ожидает догрузки")}
                      </span>
                    </div>
                    <p className="mt-2 font-mono text-[11px] text-white/55 line-clamp-2">{c.courtName}</p>
                    <p className="mt-1 font-mono text-[10px] text-white/35">{c.category}</p>
                    {(c.plaintiff || c.defendant) && (
                      <p className="mt-3 font-mono text-[10px] text-white/45 line-clamp-2">
                        {[c.plaintiff, c.defendant].filter(Boolean).join(" / ")}
                      </p>
                    )}
                    <div className="mt-4 flex flex-wrap gap-2 font-mono text-[9px] text-white/30">
                      {c.judge && <span>{c.judge}</span>}
                      {c.hearingDate && (
                        <span className="text-emerald-400/70">
                          {c.hearingDate}{c.hearingTime ? ` ${c.hearingTime}` : ""}
                        </span>
                      )}
                      {(c.documentsCount > 0) && (
                        <span className="text-sky-400/80">
                          {c.documentsCount} док.
                        </span>
                      )}
                      {(c.eventsCount ?? c.events?.length ?? 0) > 0 && (
                        <span className="text-white/40">{c.eventsCount ?? c.events?.length} событ.</span>
                      )}
                      {c.hasActText && <span className="text-emerald-400/80">акты в поиске</span>}
                    </div>
                    <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.15em] text-white/25 opacity-0 transition group-hover:opacity-100">
                      Подробнее →
                    </p>
                  </motion.button>
                ))}
              </AnimatePresence>
            </div>
          )}
        </section>

        <div className="mt-12 hidden gap-6 md:flex">
          <button type="button" onClick={() => navigate("/cabinet")} className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/50 hover:text-white">
            ← Кабинет
          </button>
          <button type="button" onClick={() => navigate("/api-docs")} className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40 hover:text-white">
            Документация
          </button>
        </div>
      </div>

      {filtersOpen ? (
        <ModalPortal>
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center px-4 md:hidden"
            style={{ paddingBottom: "calc(var(--nav-bottom) + env(safe-area-inset-bottom))" }}
            role="dialog"
            aria-modal="true"
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/85"
              aria-label="Закрыть фильтры"
              onClick={() => setFiltersOpen(false)}
            />
            <div
              className="relative z-10 flex max-h-[min(78dvh,640px)] w-full max-w-md flex-col overflow-hidden rounded-xl border border-white/20 shadow-[0_24px_80px_rgba(0,0,0,0.85)]"
              style={{ background: "#0a0a0a" }}
            >
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/50">Фильтры</p>
                <button
                  type="button"
                  onClick={() => setFiltersOpen(false)}
                  className="border border-amber-400/50 bg-amber-400/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-amber-200"
                >
                  Готово
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <CaseFiltersPanel {...filterProps} embedded />
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}

      {(detailLoading || dossierLoading) && (
        <ModalPortal>
          <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <p className="border border-amber-400/40 bg-black px-6 py-4 font-mono text-sm text-amber-200">
              {dossierLoading ? "Собираем карточку участника…" : "Загрузка карточки дела…"}
            </p>
          </div>
        </ModalPortal>
      )}

      <AnimatePresence>
        {dossier && (
          <ParticipantDossierModal
            key={dossier.person.id}
            dossier={dossier}
            onClose={() => {
              setDossier(null);
              if (caseFromDossier) setCaseFromDossier(false);
            }}
            onOpenCase={(c) => {
              setCaseFromDossier(true);
              setDossier(null);
              setDetail(c);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {detail && !dossier && (
          <CaseDetail
            key={detail.id}
            caseData={detail}
            onClose={() => {
              setDetail(null);
              setCaseFromDossier(false);
            }}
            backLabel={caseFromDossier ? "К списку дел" : "К списку дел"}
            onParticipantClick={(p) => void openParticipant(p)}
          />
        )}
      </AnimatePresence>
    </main>
  );
}
