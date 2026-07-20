import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import type { ParticipantDossier as Dossier, StoredCase } from "../lib/api.js";
import { getCaseDetail } from "../lib/api.js";
import RepCard from "./RepCard.js";
import CaseDetail from "./CaseDetail.js";
import ModalPortal from "./ModalPortal.js";
import RussiaHeatMap from "./RussiaHeatMap.js";
import { RatingBreakdown, StatBars } from "./StatBars.js";
import CardAiPanel from "./CardAiPanel.js";

const OUTCOME_RU: Record<string, string> = {
  granted: "Удовлетворено",
  granted_partial: "Частично",
  denied: "Отказ",
  settled: "Мировое",
  terminated: "Прекращено",
  returned: "Возвращено",
  appealed_upheld: "Без изменения",
  appealed_changed: "Отменено / изменено",
  unknown: "Неизвестно",
};

type TabId = "overview" | "geo" | "practice" | "cases" | "ai";

function pct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function TabBtn({
  id,
  active,
  onClick,
  children,
}: {
  id: TabId;
  active: boolean;
  onClick: (id: TabId) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className={`shrink-0 border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] transition ${
        active
          ? "border-amber-400/60 bg-amber-400/10 text-amber-200"
          : "border-white/15 text-white/50 hover:border-white/35 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

interface Props {
  dossier: Dossier;
  onClose: () => void;
  onOpenCase?: (c: StoredCase) => void;
}

export default function ParticipantDossierModal({ dossier, onClose, onOpenCase }: Props) {
  const [tab, setTab] = useState<TabId>("overview");
  const [caseDetail, setCaseDetail] = useState<StoredCase | null>(null);
  const [caseLoading, setCaseLoading] = useState(false);
  const d = dossier;

  const openCase = async (id: string) => {
    setCaseLoading(true);
    try {
      const full = await getCaseDetail(id);
      if (onOpenCase) onOpenCase(full);
      else setCaseDetail(full);
    } catch (e) {
      console.error(e);
    } finally {
      setCaseLoading(false);
    }
  };

  if (caseDetail) {
    return (
      <CaseDetail
        key={caseDetail.id}
        caseData={caseDetail}
        onClose={() => setCaseDetail(null)}
        backLabel={`К ${d.roleLabel}`}
        contextLabel={`${d.roleLabel}: ${d.person.name}`}
        onParticipantClick={undefined}
      />
    );
  }

  const factors = d.ratingFactors ?? [];
  const geo = d.geoHeat ?? [];
  const outcomeItems = Object.entries(d.outcomes)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => ({ label: OUTCOME_RU[k] ?? k, value: n }));
  const courtItems = d.byCourt.map((c) => ({
    label: c.subdomain,
    value: c.count,
    sub: c.name.replace(/Республики Мордовия/i, "РМ").slice(0, 40),
  }));
  const catItems = d.byCategory.map((c) => ({ label: c.name, value: c.count }));
  const yearItems = d.byYear.map((y) => ({ label: y.year, value: y.count }));

  return (
    <ModalPortal>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[160] overflow-y-auto bg-black"
        onClick={onClose}
      >
        <div className="min-h-[100dvh] px-3 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-[calc(4.5rem+env(safe-area-inset-top))] sm:px-8 sm:pb-16 sm:pt-20" onClick={(e) => e.stopPropagation()}>
          <div className="mx-auto flex max-w-7xl flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-amber-400/70">
                {d.roleLabel}
              </p>
              <h1 className="mt-1 break-words font-display text-2xl uppercase text-white sm:text-4xl">
                {d.person.name}
              </h1>
              <p className="mt-1 font-mono text-[12px] text-white/45">
                роли: {d.person.roles.slice(0, 8).join(" · ") || d.roleLabel}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="border border-white/25 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.15em] text-white/70 hover:border-white hover:text-white"
            >
              Закрыть
            </button>
          </div>

          <div className="mx-auto mt-8 grid max-w-7xl gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
            <div className="flex flex-col items-center gap-4 lg:sticky lg:top-24 lg:self-start">
              <RepCard dossier={d} large />
              <p className="max-w-[220px] text-center font-mono text-[10px] leading-relaxed text-white/35">
                {d.caveat}
              </p>
            </div>

            <div className="min-w-0 space-y-5">
              <div className="tab-scroll pb-1">
                <TabBtn id="overview" active={tab === "overview"} onClick={setTab}>Обзор</TabBtn>
                <TabBtn id="geo" active={tab === "geo"} onClick={setTab}>География</TabBtn>
                <TabBtn id="practice" active={tab === "practice"} onClick={setTab}>Практика</TabBtn>
                <TabBtn id="cases" active={tab === "cases"} onClick={setTab}>
                  Дела ({d.cases.length})
                </TabBtn>
                <TabBtn id="ai" active={tab === "ai"} onClick={setTab}>A2chatski</TabBtn>
              </div>

              {tab === "overview" && (
                <div className="space-y-6">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {[
                      { label: "Дела", value: d.stats.cases },
                      { label: "Суды", value: d.stats.courts },
                      { label: "С актами", value: d.stats.withActs },
                      { label: "Полные карточки", value: d.stats.enrichedCases },
                      { label: "Побед / отказов", value: `${d.stats.wins}/${d.stats.losses}` },
                      { label: "Успех", value: pct(d.stats.winRate) },
                      { label: "Исходы изв.", value: d.stats.knownOutcomes },
                      {
                        label: "Цикл (середина)",
                        value: d.stats.medianDays != null ? `${Math.round(d.stats.medianDays)}д` : "—",
                      },
                    ].map((s) => (
                      <div key={s.label} className="border border-white/10 p-3">
                        <p className="font-mono text-[8px] uppercase tracking-wider text-white/35">{s.label}</p>
                        <p className="mt-1 font-display text-2xl text-white">{s.value}</p>
                      </div>
                    ))}
                  </div>
                  <RatingBreakdown factors={factors} rating={d.rating} tier={d.tier} />
                </div>
              )}

              {tab === "geo" && (
                <RussiaHeatMap
                  cells={geo}
                  courtCells={d.byCourt.map((c) => ({
                    subdomain: c.subdomain,
                    name: c.name,
                    cases: c.count,
                  }))}
                  title="Куда ходит практика"
                />
              )}

              {tab === "practice" && (
                <div className="space-y-6">
                  <div className="grid gap-6 lg:grid-cols-2">
                    <StatBars title="Исходы" items={outcomeItems} valueLabel="" />
                    <StatBars title="По годам" items={yearItems} />
                  </div>
                  <div className="grid gap-6 lg:grid-cols-2">
                    <StatBars title="Суды" items={courtItems} />
                    <StatBars title="Категории споров" items={catItems} />
                  </div>
                </div>
              )}

              {tab === "cases" && (
                <section className="border border-white/10 p-4">
                  <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
                    {d.cases.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => void openCase(c.id)}
                          disabled={caseLoading}
                          className="w-full border border-white/10 px-4 py-3 text-left transition hover:border-amber-400/40 hover:bg-amber-400/5 disabled:opacity-50"
                        >
                          <span className="font-mono text-sm text-white">{c.caseNumber}</span>
                          <span className="ml-2 font-mono text-[10px] text-white/40">{c.roleOnCase}</span>
                          <span className="ml-2 font-mono text-[10px] text-amber-300/70">
                            {OUTCOME_RU[c.outcome] ?? c.outcome}
                          </span>
                          <span className="mt-1 block truncate font-mono text-[10px] text-white/45">
                            {c.courtName} · {c.category}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {tab === "ai" && (
                <CardAiPanel
                  kind="participant"
                  id={d.person.id}
                  name={d.person.name}
                  role={d.person.primaryFamily !== "other" ? d.person.primaryFamily : undefined}
                  disabled={d.stats.cases < 1}
                />
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </ModalPortal>
  );
}
