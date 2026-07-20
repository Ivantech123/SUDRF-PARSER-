import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { getLawyerHeatmap, type LawyerHeatmapCell } from "../lib/api.js";

const ROLE_LABELS: Record<string, string> = {
  lawyer: "юристов",
  judge: "судей",
};

export default function LawyerHeatmap({ role }: { role: "lawyer" | "judge" }) {
  const [cells, setCells] = useState<LawyerHeatmapCell[]>([]);
  const [mode, setMode] = useState<"professionals" | "cases">("cases");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      setLoading(true);
      try {
        const d = await getLawyerHeatmap(role);
        if (cancelled) return;
        setCells(d.cells);
        setMode(d.mode);
        if (d.indexReady === false) {
          pollTimer = setTimeout(() => void load(), 5000);
        }
      } catch {
        if (!cancelled) setCells([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [role]);

  const max = useMemo(() => Math.max(1, ...cells.map((c) => c.total)), [cells]);
  const top = cells.slice(0, 24);
  const isCaseMode = mode === "cases";

  if (loading) {
    return (
      <div className="border border-white/10 p-6">
        <p className="font-mono text-[11px] text-white/40">Строим индекс карточек…</p>
      </div>
    );
  }

  if (!top.length) {
    return (
      <div className="border border-white/10 p-6">
        <p className="font-mono text-[11px] text-white/40">Нет данных для карты.</p>
      </div>
    );
  }

  return (
    <section className="border border-white/10 p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-amber-400/70">География каталога</p>
          <h2 className="mt-1 font-display text-xl uppercase text-white">
            {isCaseMode ? "Тепловая карта — дела по регионам" : `Тепловая карта — ${ROLE_LABELS[role]}`}
          </h2>
        </div>
        <p className="font-mono text-[10px] text-white/35">
          {isCaseMode
            ? "Пока мало карточек — показана плотность дел"
            : "По каталогу дел, не по полнотекстовому поиску"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {top.map((cell, i) => {
          const intensity = cell.total / max;
          const bg = isCaseMode
            ? `rgba(56, 189, 248, ${0.1 + intensity * 0.5})`
            : `rgba(251, 191, 36, ${0.12 + intensity * 0.55})`;
          const border = isCaseMode
            ? `rgba(56, 189, 248, ${0.25 + intensity * 0.55})`
            : `rgba(251, 191, 36, ${0.25 + intensity * 0.65})`;
          return (
            <motion.div
              key={cell.region}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: Math.min(i * 0.02, 0.4) }}
              className="min-w-0 border px-2 py-3"
              style={{ background: bg, borderColor: border }}
              title={
                isCaseMode
                  ? `${cell.label}: ${cell.caseCount ?? cell.total} дел`
                  : `${cell.label}: ${cell.lawyers} юр., ${cell.judges} суд.`
              }
            >
              <p className="truncate font-mono text-[10px] font-bold text-amber-100/95">{cell.label}</p>
              <p className="mt-1 font-display text-2xl leading-none text-white">{cell.total.toLocaleString()}</p>
              <p className="mt-1 font-mono text-[8px] text-white/50">
                {isCaseMode ? "дел в каталоге" : `ЮР ${cell.lawyers} · СУД ${cell.judges}`}
              </p>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
