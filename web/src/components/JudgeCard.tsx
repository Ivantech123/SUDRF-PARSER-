// Judicial plaque card — FIFA-like tiers, fixed vertical zones (no overlapping layers).

import { motion } from "framer-motion";
import type { LawyerCard } from "../lib/api.js";

const TIER: Record<
  LawyerCard["tier"],
  { frame: string; ink: string; ivory: string; ribbon: string; seal: string }
> = {
  gold: {
    frame: "#c9a227",
    ink: "#1a1408",
    ivory: "#f7f0dd",
    ribbon: "#8b1e2d",
    seal: "#c9a227",
  },
  silver: {
    frame: "#a8b0bc",
    ink: "#12151a",
    ivory: "#eef1f4",
    ribbon: "#2c3e50",
    seal: "#8a939e",
  },
  bronze: {
    frame: "#b87333",
    ink: "#1a0e08",
    ivory: "#f3e6d4",
    ribbon: "#5c2e12",
    seal: "#b87333",
  },
  common: {
    frame: "#6b7280",
    ink: "#0f1216",
    ivory: "#e8eaed",
    ribbon: "#1e293b",
    seal: "#64748b",
  },
};

const TIER_RU: Record<string, string> = {
  gold: "высший",
  silver: "высокий",
  bronze: "средний",
  common: "базовый",
};

function shortCourt(name: string): string {
  return name
    .replace(/Республики Мордовия/gi, "РМ")
    .replace(/районный суд/gi, "райсуд")
    .replace(/городской суд/gi, "горсуд")
    .slice(0, 36);
}

export default function JudgeCard({
  card,
  onClick,
  large,
}: {
  card: LawyerCard;
  onClick?: () => void;
  large?: boolean;
}) {
  const t = TIER[card.tier];
  const size = large ? "pro-card-lg" : "pro-card-sm";

  const jp = card.judgePractice;
  const med = jp?.medianDays != null ? `${Math.round(jp.medianDays)}д` : "—";
  const appeal =
    jp?.appealChangeRate != null ? `${Math.round(jp.appealChangeRate * 100)}%` : "—";
  const fav =
    jp?.plaintiffFavorRate != null ? `${Math.round(jp.plaintiffFavorRate * 100)}%` : "—";
  const stats = [
    { k: "срок", v: med },
    { k: "удовл.", v: fav },
    { k: "отмены", v: appeal },
  ];

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={onClick ? { y: -4 } : undefined}
      whileTap={onClick ? { scale: 0.99 } : undefined}
      className={`${size} relative shrink-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
        onClick ? "cursor-pointer" : "cursor-default"
      }`}
    >
      <div
        className="absolute inset-0 flex flex-col overflow-hidden shadow-2xl"
        style={{
          background: t.ivory,
          border: `3px solid ${t.frame}`,
          boxShadow: `0 10px 36px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.35)`,
          borderRadius: "4px",
        }}
      >
        {/* Zone 1 — ribbon */}
        <div
          className="flex shrink-0 items-center justify-between px-2.5 py-1.5"
          style={{ background: t.ribbon }}
        >
          <span className="font-mono text-[8px] font-bold uppercase tracking-[0.18em] text-white/95">
            Судья
          </span>
          <span className="font-mono text-[8px] uppercase tracking-wider text-white/75">
            {TIER_RU[card.tier]}
          </span>
        </div>

        {/* Zone 2 — seal */}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-2">
          <div
            className={`flex flex-col items-center justify-center rounded-full border-2 ${
              large ? "h-20 w-20" : "h-14 w-14"
            }`}
            style={{
              borderColor: t.seal,
              background: `radial-gradient(circle at 35% 30%, ${t.ivory}, ${t.frame}55)`,
              color: t.ink,
              boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
            }}
          >
            <span className={`font-display leading-none ${large ? "text-3xl" : "text-2xl"}`}>
              {card.rating}
            </span>
            <span className="font-mono text-[6px] uppercase tracking-wider opacity-70">индекс</span>
          </div>
        </div>

        {/* Zone 3 — stats (never under name) */}
        <div
          className="mx-2 shrink-0 grid grid-cols-3 gap-1 border-y py-1.5"
          style={{ borderColor: `${t.ink}22` }}
        >
          {stats.map((st) => (
            <div key={st.k} className="text-center">
              <div
                className={`font-display leading-none ${large ? "text-lg" : "text-[13px]"}`}
                style={{ color: t.ink }}
              >
                {st.v}
              </div>
              <div
                className="mt-0.5 font-mono text-[6px] uppercase tracking-wider"
                style={{ color: `${t.ink}99` }}
              >
                {st.k}
              </div>
            </div>
          ))}
        </div>

        {/* Zone 4 — solid name band (opaque, no bleed) */}
        <div
          className="shrink-0 px-2 pb-2 pt-1.5"
          style={{ background: "#efe6d0", borderTop: `1px solid ${t.frame}55` }}
        >
          <p
            className={`line-clamp-2 text-center font-display uppercase leading-tight tracking-wide ${
              large ? "text-sm" : "text-[11px]"
            }`}
            style={{ color: t.ink }}
          >
            {card.name}
          </p>
          <p
            className="mt-0.5 truncate text-center font-mono text-[7px] uppercase tracking-wider"
            style={{ color: `${t.ink}99` }}
          >
            {shortCourt(card.mainCourt)}
          </p>
          {onClick && !large ? (
            <p
              className="mt-1 text-center font-mono text-[6px] uppercase tracking-wider"
              style={{ color: `${t.ink}66` }}
            >
              Открыть досье
            </p>
          ) : null}
        </div>

        {/* Corner ornaments — decorative only */}
        <div
          className="pointer-events-none absolute left-1 top-8 h-2.5 w-2.5 border-l-2 border-t-2"
          style={{ borderColor: t.frame }}
        />
        <div
          className="pointer-events-none absolute right-1 top-8 h-2.5 w-2.5 border-r-2 border-t-2"
          style={{ borderColor: t.frame }}
        />
        <div
          className="pointer-events-none absolute bottom-1 left-1 h-2.5 w-2.5 border-b-2 border-l-2"
          style={{ borderColor: t.frame }}
        />
        <div
          className="pointer-events-none absolute bottom-1 right-1 h-2.5 w-2.5 border-b-2 border-r-2"
          style={{ borderColor: t.frame }}
        />
      </div>
    </motion.button>
  );
}
