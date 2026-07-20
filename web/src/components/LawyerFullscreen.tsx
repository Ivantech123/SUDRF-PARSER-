import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import type { LawyerCard } from "../lib/api.js";
import ProCard from "./ProCard.js";
import RussiaHeatMap from "./RussiaHeatMap.js";
import { RatingBreakdown, StatBars } from "./StatBars.js";
import JudgePracticePanel from "./JudgePracticePanel.js";
import CardAiPanel from "./CardAiPanel.js";
import ModalPortal from "./ModalPortal.js";

type TabId = "overview" | "geo" | "practice" | "cases" | "ai";

function formatDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("ru-RU");
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

export default function LawyerFullscreen({
  card,
  onClose,
  onOpenCase,
  caseLoading,
}: {
  card: LawyerCard;
  onClose: () => void;
  onOpenCase: (caseId: string) => void;
  caseLoading?: boolean;
}) {
  const [tab, setTab] = useState<TabId>("overview");
  const geo = card.geoHeat ?? [];
  const factors = card.ratingFactors ?? [];
  const courts = (card.courtHeat ?? []).map((c) => ({
    label: c.subdomain,
    value: c.cases,
    sub: c.name.replace(/Республики Мордовия/i, "РМ").slice(0, 40),
  }));
  const cats = (card.categoryHeat ?? card.categories.map((n) => ({ name: n, count: 1 }))).map((c) => ({
    label: c.name,
    value: c.count,
  }));

  const kpi = card.primaryRole === "judge"
    ? [
        { label: "Дела в каталоге", value: card.stats.cases },
        { label: "С актами", value: card.stats.withActs },
        { label: "Полные карточки", value: card.stats.enrichedCases },
        { label: "Суды", value: card.stats.courts },
      ]
    : [
        { label: "Дела", value: card.stats.cases },
        { label: "Суды", value: card.stats.courts },
        { label: "С актами", value: card.stats.withActs },
        { label: "Полные карточки", value: card.stats.enrichedCases },
      ];

  const extraKpi = card.primaryRole === "judge"
    ? [
        { label: "Гражданские", value: card.stats.civilCases },
        { label: "Уголовные", value: card.stats.criminalCases },
        { label: "Категории споров", value: card.stats.categories },
        { label: "Документы", value: card.stats.documents },
      ]
    : [
        { label: "Регионы", value: card.stats.regions },
        { label: "Гражданские", value: card.stats.civilCases },
        { label: "Уголовные", value: card.stats.criminalCases },
        { label: "Документы", value: card.stats.documents },
      ];

  return (
    <ModalPortal>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[150] overflow-y-auto bg-black"
        onClick={onClose}
      >
        <div
          className="min-h-[100dvh] px-3 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-[calc(4.5rem+env(safe-area-inset-top))] sm:px-8 sm:pb-16 sm:pt-20"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mx-auto flex max-w-7xl flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-amber-400/70">
                {card.primaryRole === "judge" ? "Судейское досье" : "Карточка юриста"}
              </p>
              <h1 className="mt-1 break-words font-display text-2xl uppercase text-white sm:text-4xl">{card.name}</h1>
              <p className="mt-1 font-mono text-[12px] text-white/45">
                {card.primaryRole === "judge" ? "Судья" : "Юрист / представитель"} · {card.mainCourt}
                {" · "}активность {formatDate(card.stats.lastActive)}
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
              <ProCard card={card} large />
            </div>

            <div className="min-w-0 space-y-5">
              <div className="tab-scroll pb-1">
                <TabBtn id="overview" active={tab === "overview"} onClick={setTab}>Обзор</TabBtn>
                <TabBtn id="geo" active={tab === "geo"} onClick={setTab}>География</TabBtn>
                <TabBtn id="practice" active={tab === "practice"} onClick={setTab}>Практика</TabBtn>
                <TabBtn id="cases" active={tab === "cases"} onClick={setTab}>
                  Дела ({card.recentCases.length})
                </TabBtn>
                <TabBtn id="ai" active={tab === "ai"} onClick={setTab}>A2chatski</TabBtn>
              </div>

              {tab === "overview" && (
                <div className="space-y-6">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {kpi.map((s) => (
                      <div key={s.label} className="border border-white/10 p-3">
                        <p className="font-mono text-[8px] uppercase tracking-wider text-white/35">{s.label}</p>
                        <p className="mt-1 font-display text-2xl text-white">{s.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {extraKpi.map((s) => (
                      <div key={s.label} className="border border-white/10 p-3">
                        <p className="font-mono text-[8px] uppercase tracking-wider text-white/35">{s.label}</p>
                        <p className="mt-1 font-display text-xl text-white/90">{s.value}</p>
                      </div>
                    ))}
                  </div>
                  <RatingBreakdown factors={factors} rating={card.rating} tier={card.tier} />
                  {card.primaryRole === "judge" ? <JudgePracticePanel card={card} /> : null}
                </div>
              )}

              {tab === "geo" && (
                <RussiaHeatMap
                  cells={geo}
                  courtCells={card.courtHeat ?? []}
                  title={card.primaryRole === "judge" ? "География рассмотрений" : "Куда ходит практика"}
                />
              )}

              {tab === "practice" && (
                <div className="grid gap-6 lg:grid-cols-2">
                  <StatBars title="Суды" items={courts} />
                  <StatBars title="Категории споров" items={cats} />
                </div>
              )}

              {tab === "cases" && (
                <section className="border border-white/10 p-4">
                  <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/45">
                    Связанные дела
                  </h3>
                  <ul className="mt-3 max-h-[60vh] space-y-2 overflow-y-auto">
                    {card.recentCases.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => onOpenCase(c.id)}
                          disabled={caseLoading}
                          className="w-full border border-white/10 px-4 py-3 text-left transition hover:border-amber-400/40 hover:bg-amber-400/5 disabled:opacity-50"
                        >
                          <span className="font-mono text-sm text-white">{c.caseNumber}</span>
                          {c.hasDocuments ? (
                            <span className="ml-2 font-mono text-[9px] text-sky-400/80">док.</span>
                          ) : null}
                          <span className="mt-1 block truncate font-mono text-[10px] text-white/45">
                            {c.courtName} · {c.category}
                            {c.hearingDate ? ` · ${c.hearingDate}` : ""}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {tab === "ai" && (
                <CardAiPanel
                  kind="lawyer"
                  id={card.id}
                  disabled={card.stats.cases < 1}
                />
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </ModalPortal>
  );
}
