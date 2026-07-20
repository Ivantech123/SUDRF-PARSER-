// Data coverage funnel — catalog quality metrics on the Cases page.

import { motion } from "framer-motion";
import type { CoverageStats } from "../lib/api.js";

interface Props {
  data: CoverageStats | null;
  loading?: boolean;
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="mt-2 h-1.5 w-full bg-white/5">
      <div className={`h-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

export default function CoveragePanel({ data, loading }: Props) {
  if (loading && !data) {
    return (
      <section className="mt-8 border border-white/10 p-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">Загрузка аналитики…</p>
      </section>
    );
  }
  if (!data) return null;

  const { totals, rates, funnel, collectionRate } = data;

  return (
    <section className="mt-8 space-y-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-white/40">Аналитика данных</p>
        <h2 className="mt-1 font-display text-2xl text-white">Воронка покрытия</h2>
        <p className="mt-2 max-w-3xl font-mono text-[12px] leading-relaxed text-white/50">
          Республика Мордовия — сколько дел дошло до решений, полного текста и поискового корпуса. В корпусе:{" "}
          {totals.ragCases.toLocaleString()} дел ({totals.inRag.toLocaleString()} совпадают с каталогом),{" "}
          {totals.ragChunks.toLocaleString()} фрагментов.
          {collectionRate && (
            <>
              {" "}
              Сбор: +{collectionRate.newLast24h} за 24 ч, ~{collectionRate.perDay7d}/сут (7 дн.).
            </>
          )}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="border border-white/10 p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">Воронка</p>
          <ul className="mt-4 space-y-4">
            {funnel.map((step, i) => (
              <motion.li
                key={step.stage}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.03 * i }}
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-mono text-[12px] text-white/70">{step.label}</span>
                  <span className="shrink-0 font-mono text-[12px] text-white">
                    {step.count.toLocaleString()}
                    <span className="ml-2 text-white/40">{step.pct}%</span>
                  </span>
                </div>
                <Bar
                  pct={step.pct}
                  color={
                    step.stage === "rag"
                      ? "bg-violet-500"
                      : step.stage === "fullText"
                        ? "bg-sky-500"
                        : step.stage === "documents"
                          ? "bg-emerald-500"
                          : "bg-white/30"
                  }
                />
              </motion.li>
            ))}
          </ul>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {[
            { label: "С полными карточками", value: totals.enriched, pct: rates.enrichedPct, color: "text-emerald-400" },
            { label: "С актами", value: totals.withDocuments, pct: rates.withDocumentsPct, color: "text-sky-400" },
            { label: "Полный текст", value: totals.withFullText, pct: rates.fullTextPct, color: "text-violet-400" },
            { label: "В поисковом корпусе", value: totals.inRag, pct: rates.inRagPct, color: "text-amber-400" },
            { label: "Очередь догрузки", value: totals.enrichPending, pct: null, color: "text-rose-400" },
            { label: "С текстом акта", value: totals.withActText, pct: rates.withActTextPct, color: "text-white" },
          ].map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04 * i }}
              className="border border-white/10 p-5"
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-white/40">{s.label}</p>
              <p className={`mt-2 font-display text-3xl ${s.color}`}>{s.value.toLocaleString()}</p>
              {s.pct != null && (
                <p className="mt-1 font-mono text-[11px] text-white/40">{s.pct}% от каталога</p>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
