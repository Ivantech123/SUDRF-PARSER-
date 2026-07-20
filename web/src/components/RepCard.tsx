// FIFA-style card for representatives — same flex zones as FifaCard (no overlaps).

import { motion } from "framer-motion";
import type { ParticipantDossier } from "../lib/api.js";

const TIER: Record<
  ParticipantDossier["tier"],
  { bg: string; border: string; shine: string; text: string; accent: string }
> = {
  gold: {
    bg: "linear-gradient(145deg, #3d2e00 0%, #c9a227 35%, #ffe566 55%, #a67c00 80%, #2a2000 100%)",
    border: "#ffd700",
    shine: "rgba(255,255,220,0.45)",
    text: "#1a1200",
    accent: "#fff8dc",
  },
  silver: {
    bg: "linear-gradient(145deg, #2a2a2e 0%, #9ca3af 40%, #e5e7eb 55%, #6b7280 80%, #1f2937 100%)",
    border: "#d1d5db",
    shine: "rgba(255,255,255,0.35)",
    text: "#111827",
    accent: "#f9fafb",
  },
  bronze: {
    bg: "linear-gradient(145deg, #3d1f0a 0%, #b45309 40%, #d97706 55%, #92400e 80%, #271005 100%)",
    border: "#cd7f32",
    shine: "rgba(255,200,120,0.3)",
    text: "#1c0a00",
    accent: "#ffedd5",
  },
  common: {
    bg: "linear-gradient(145deg, #1a1a1a 0%, #404040 45%, #525252 55%, #262626 100%)",
    border: "#737373",
    shine: "rgba(255,255,255,0.12)",
    text: "#f5f5f5",
    accent: "#e5e5e5",
  },
};

const TIER_RU: Record<string, string> = {
  gold: "высший",
  silver: "высокий",
  bronze: "средний",
  common: "базовый",
};

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function RepCard({
  dossier,
  large,
  onClick,
}: {
  dossier: ParticipantDossier;
  large?: boolean;
  onClick?: () => void;
}) {
  const s = TIER[dossier.tier];
  const size = large ? "pro-card-lg" : "pro-card-sm";
  const win =
    dossier.stats.winRate != null ? `${Math.round(dossier.stats.winRate * 100)}%` : "—";

  const stats = [
    { k: "ДЕЛ", v: dossier.stats.cases },
    { k: "СУД", v: dossier.stats.courts },
    { k: "АКТ", v: dossier.stats.withActs },
    { k: "УСПЕХ", v: win },
  ];

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={onClick ? { scale: 1.04, y: -6 } : undefined}
      whileTap={onClick ? { scale: 0.98 } : undefined}
      className={`${size} relative shrink-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-white/50 ${
        onClick ? "cursor-pointer" : "cursor-default"
      }`}
    >
      <div
        className="absolute inset-0 flex flex-col overflow-hidden rounded-lg shadow-2xl"
        style={{
          background: s.bg,
          border: `2px solid ${s.border}`,
          boxShadow: `0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 ${s.shine}`,
        }}
      >
        <div className="flex shrink-0 items-start justify-between px-2.5 pt-2">
          <div className="flex flex-col items-center">
            <span
              className={`font-display leading-none ${large ? "text-5xl" : "text-3xl"}`}
              style={{ color: s.text, textShadow: "0 1px 0 rgba(255,255,255,0.3)" }}
            >
              {dossier.rating}
            </span>
            <span className="mt-0.5 font-mono text-[8px] font-bold tracking-wider" style={{ color: s.text }}>
              ПРЕДСТ.
            </span>
          </div>
          <span
            className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase"
            style={{ background: "rgba(0,0,0,0.25)", color: s.accent }}
          >
            {TIER_RU[dossier.tier] ?? dossier.tier}
          </span>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center">
          <div
            className={`flex items-center justify-center rounded-full border-2 border-white/30 bg-black/25 font-display backdrop-blur-sm ${
              large ? "h-20 w-20 text-3xl" : "h-12 w-12 text-xl"
            }`}
            style={{ color: s.accent }}
          >
            {initials(dossier.person.name)}
          </div>
        </div>

        <div className="shrink-0 grid grid-cols-4 gap-0 px-1 pb-1">
          {stats.map((st) => (
            <div key={st.k} className="text-center">
              <div
                className={`font-display leading-none ${large ? "text-xl" : "text-[13px]"}`}
                style={{ color: s.text }}
              >
                {st.v}
              </div>
              <div className="font-mono text-[6px] tracking-wider opacity-80" style={{ color: s.text }}>
                {st.k}
              </div>
            </div>
          ))}
        </div>

        <div className="shrink-0 px-2 pb-2 pt-1.5" style={{ background: "rgba(0,0,0,0.72)" }}>
          <p
            className={`line-clamp-2 text-center font-display uppercase leading-tight tracking-wide ${
              large ? "text-sm" : "text-[11px]"
            }`}
            style={{ color: s.accent }}
          >
            {dossier.person.name}
          </p>
          <p
            className="mt-0.5 truncate text-center font-mono text-[7px] uppercase tracking-wider"
            style={{ color: s.accent, opacity: 0.85 }}
          >
            {dossier.roleLabel}
          </p>
          {onClick && !large ? (
            <p
              className="mt-1 text-center font-mono text-[6px] uppercase tracking-wider"
              style={{ color: s.accent, opacity: 0.65 }}
            >
              открыть полностью
            </p>
          ) : null}
        </div>
      </div>
    </motion.button>
  );
}
