import type { LawyerCard } from "../lib/api.js";
import { StatBars } from "./StatBars.js";

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

function pct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function days(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Math.round(n)} дн`;
}

/** Judge-specific metrics block for fullscreen dossier. */
export default function JudgePracticePanel({ card }: { card: LawyerCard }) {
  const jp = card.judgePractice;
  if (!jp) {
    return (
      <div className="border border-white/10 p-4">
        <p className="font-mono text-[11px] text-white/40">Судейская практика ещё считается…</p>
      </div>
    );
  }

  const outcomes = Object.entries(jp.outcomes)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => ({ label: OUTCOME_RU[k] ?? k, value: n }));

  return (
    <section className="space-y-4 border border-amber-400/20 bg-amber-400/[0.03] p-4">
      <div>
        <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-amber-400/70">
          Судейская практика
        </p>
        <h3 className="mt-1 font-display text-sm uppercase text-white">
          Сроки · исходы · апелляция · банки
        </h3>
        <p className="mt-2 max-w-3xl font-mono text-[11px] leading-relaxed text-white/40">
          Считается по делам, где этот судья указан в карточке. Отмены в апелляции — по делам 11-*,
          где он судья первой инстанции. Банки — истец похож на банк.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "Срок дела (середина)",
            value: days(jp.medianDays),
            hint: `дел с датами: ${jp.withDuration}`,
          },
          {
            label: "Медленная четверть",
            value: days(jp.p75Days),
            hint: "25% дел дольше",
          },
          {
            label: "Удовл. иска",
            value: pct(jp.plaintiffFavorRate),
            hint: `${jp.plaintiffFavorable} из ${jp.knownOutcomes} с исходом`,
          },
          {
            label: "Отказы",
            value: String(jp.denied),
            hint: "первая инстанция",
          },
          {
            label: "Отмены в апелляции",
            value: pct(jp.appealChangeRate),
            hint: `${jp.appealChanged} из ${jp.appealReviewed}`,
          },
          {
            label: "Банки → удовл.",
            value: pct(jp.bankFavorRate),
            hint: `банковских дел: ${jp.bankCases}`,
          },
          {
            label: "1 инстанция",
            value: String(jp.firstInstance),
            hint: "номера 2-*",
          },
          {
            label: "Апелляции (как судья)",
            value: String(jp.appealLike),
            hint: "номера 11-* в поле судьи",
          },
        ].map((s) => (
          <div key={s.label} className="border border-white/10 bg-black/40 p-3">
            <p className="font-mono text-[8px] uppercase tracking-wider text-white/35">{s.label}</p>
            <p className="mt-1 font-display text-2xl text-white">{s.value}</p>
            <p className="mt-1 font-mono text-[10px] text-white/35">{s.hint}</p>
          </div>
        ))}
      </div>

      <StatBars title="Распределение исходов" items={outcomes} valueLabel="" />
    </section>
  );
}
