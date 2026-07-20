export function StatBars({
  title,
  items,
  valueLabel = "дел",
}: {
  title: string;
  items: Array<{ label: string; value: number; sub?: string }>;
  valueLabel?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) {
    return (
      <div className="border border-white/10 p-4">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/45">{title}</h3>
        <p className="mt-3 font-mono text-[11px] text-white/35">Пока нет данных</p>
      </div>
    );
  }
  return (
    <div className="border border-white/10 p-4">
      <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/45">{title}</h3>
      <ul className="mt-3 max-h-64 space-y-2 overflow-auto">
        {items.map((i) => (
          <li key={i.label}>
            <div className="flex justify-between gap-2 font-mono text-[11px] text-white/70">
              <span className="truncate">
                {i.label}
                {i.sub ? <span className="text-white/35"> · {i.sub}</span> : null}
              </span>
              <span className="shrink-0">
                {i.value} {valueLabel}
              </span>
            </div>
            <div className="mt-1 h-1.5 bg-white/5">
              <div className="h-full bg-amber-400/70" style={{ width: `${(i.value / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RatingBreakdown({
  factors,
  rating,
  tier,
}: {
  factors: Array<{ label: string; score: number; max: number }>;
  rating: number;
  tier: string;
}) {
  const TIER_RU: Record<string, string> = {
    gold: "золото",
    silver: "серебро",
    bronze: "бронза",
    common: "обычная",
  };
  return (
    <div className="border border-white/10 p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-amber-400/70">Рейтинг</p>
          <p className="mt-1 font-display text-4xl text-white">{rating}</p>
          <p className="font-mono text-[11px] text-white/40">уровень: {TIER_RU[tier] ?? tier}</p>
        </div>
        <p className="max-w-xs font-mono text-[10px] leading-relaxed text-white/35">
          Складывается из объёма дел, судов, актов, географии и роли. Шкала 55–99.
        </p>
      </div>
      <ul className="mt-4 space-y-2">
        {factors.map((f) => (
          <li key={f.label}>
            <div className="flex justify-between gap-2 font-mono text-[11px] text-white/70">
              <span>{f.label}</span>
              <span>
                {f.score}/{f.max}
              </span>
            </div>
            <div className="mt-1 h-1.5 bg-white/5">
              <div
                className="h-full bg-sky-400/70"
                style={{ width: `${Math.min(100, (f.score / Math.max(1, f.max)) * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
