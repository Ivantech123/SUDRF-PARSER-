/** Geography heat: Russia by region OR courts grid — with toggle. */

import { useMemo, useState } from "react";

export interface RussiaHeatCell {
  region: string;
  label: string;
  cases: number;
}

export interface CourtHeatCell {
  subdomain: string;
  name: string;
  cases: number;
}

type Mode = "regions" | "courts";

/** Positions as % of the map box (x,y). */
const REGION_XY: Record<string, { x: number; y: number }> = {
  "77": { x: 38, y: 48 },
  "50": { x: 40, y: 50 },
  "78": { x: 32, y: 32 },
  "47": { x: 34, y: 34 },
  "13": { x: 48, y: 55 },
  "52": { x: 50, y: 52 },
  "58": { x: 46, y: 58 },
  "73": { x: 52, y: 60 },
  "16": { x: 56, y: 50 },
  "12": { x: 54, y: 46 },
  "21": { x: 58, y: 54 },
  "63": { x: 54, y: 62 },
  "64": { x: 50, y: 66 },
  "02": { x: 62, y: 58 },
  "59": { x: 68, y: 46 },
  "66": { x: 72, y: 48 },
  "74": { x: 70, y: 56 },
  "54": { x: 82, y: 54 },
  "24": { x: 86, y: 58 },
  "25": { x: 94, y: 66 },
  "14": { x: 90, y: 34 },
  "23": { x: 42, y: 78 },
  "61": { x: 44, y: 74 },
  "26": { x: 40, y: 76 },
  "34": { x: 46, y: 70 },
  "36": { x: 42, y: 64 },
  "48": { x: 44, y: 60 },
  "31": { x: 40, y: 58 },
  "67": { x: 36, y: 52 },
  "69": { x: 38, y: 46 },
  "76": { x: 42, y: 44 },
  "33": { x: 44, y: 48 },
  "37": { x: 46, y: 46 },
  "44": { x: 48, y: 44 },
};

function posFor(code: string, index: number): { x: number; y: number } {
  if (REGION_XY[code]) return REGION_XY[code]!;
  const angle = (index * 47) % 360;
  const rad = (angle * Math.PI) / 180;
  return {
    x: 55 + Math.cos(rad) * 22,
    y: 48 + Math.sin(rad) * 18,
  };
}

function shortCourt(name: string, subdomain: string): string {
  const cleaned = name
    .replace(/Республики Мордовия/gi, "РМ")
    .replace(/районный суд/gi, "райсуд")
    .replace(/городской суд/gi, "горсуд")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || subdomain).slice(0, 42);
}

export default function RussiaHeatMap({
  cells,
  courtCells = [],
  title = "Куда ходит практика",
}: {
  cells: RussiaHeatCell[];
  courtCells?: CourtHeatCell[];
  title?: string;
}) {
  const hasCourts = courtCells.some((c) => c.cases > 0);
  const [mode, setMode] = useState<Mode>(hasCourts && cells.length <= 1 ? "courts" : "regions");

  const regionActive = useMemo(() => cells.filter((c) => c.cases > 0), [cells]);
  const regionMax = Math.max(1, ...regionActive.map((c) => c.cases));

  const courtActive = useMemo(
    () => [...courtCells].filter((c) => c.cases > 0).sort((a, b) => b.cases - a.cases),
    [courtCells],
  );
  const courtMax = Math.max(1, ...courtActive.map((c) => c.cases));

  return (
    <div className="border border-white/10 p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-amber-400/70">
            {mode === "regions" ? "Карта России" : "Тепловая карта судов"}
          </p>
          <h3 className="mt-1 font-display text-sm uppercase text-white">{title}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex border border-white/15">
            <button
              type="button"
              onClick={() => setMode("regions")}
              className={`px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] transition ${
                mode === "regions"
                  ? "bg-amber-400/15 text-amber-200"
                  : "text-white/45 hover:text-white"
              }`}
            >
              Регионы
            </button>
            <button
              type="button"
              onClick={() => setMode("courts")}
              disabled={!hasCourts}
              className={`px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] transition disabled:opacity-30 ${
                mode === "courts"
                  ? "bg-amber-400/15 text-amber-200"
                  : "text-white/45 hover:text-white"
              }`}
            >
              Суды
            </button>
          </div>
          <p className="font-mono text-[10px] text-white/35">
            ярче = больше дел
          </p>
        </div>
      </div>

      {mode === "regions" ? (
        <>
          <div className="relative aspect-[16/9] w-full overflow-hidden border border-white/10 bg-[#07080c]">
            <svg viewBox="0 0 100 60" className="absolute inset-0 h-full w-full opacity-40" aria-hidden>
              <path
                d="M8,22 C18,10 32,8 48,12 C62,8 78,10 92,18 C96,28 94,38 88,44 C78,52 62,54 48,50 C36,54 22,50 12,42 C6,34 4,28 8,22 Z"
                fill="rgba(251,191,36,0.08)"
                stroke="rgba(251,191,36,0.25)"
                strokeWidth="0.4"
              />
              <path
                d="M10,38 C16,34 22,36 28,40 C24,46 16,48 10,44 Z"
                fill="rgba(251,191,36,0.06)"
                stroke="rgba(251,191,36,0.2)"
                strokeWidth="0.3"
              />
            </svg>

            {!regionActive.length ? (
              <p className="absolute inset-0 flex items-center justify-center font-mono text-[11px] text-white/35">
                Нет привязки к регионам
              </p>
            ) : (
              regionActive.map((cell, i) => {
                const { x, y } = posFor(cell.region, i);
                const intensity = cell.cases / regionMax;
                const size = 10 + intensity * 18;
                return (
                  <div
                    key={cell.region}
                    className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border text-center"
                    style={{
                      left: `${x}%`,
                      top: `${y}%`,
                      width: size,
                      height: size,
                      background: `rgba(251, 191, 36, ${0.2 + intensity * 0.65})`,
                      borderColor: `rgba(251, 191, 36, ${0.35 + intensity * 0.55})`,
                      boxShadow: cell.region === "13" ? "0 0 16px rgba(251,191,36,0.45)" : undefined,
                    }}
                    title={`${cell.label}: ${cell.cases} дел`}
                  >
                    <span className="sr-only">{cell.label}</span>
                  </div>
                );
              })
            )}
          </div>

          <ul className="mt-3 grid max-h-36 grid-cols-2 gap-1 overflow-auto sm:grid-cols-3">
            {regionActive.slice(0, 12).map((cell) => (
              <li
                key={cell.region}
                className="flex items-center justify-between gap-2 border border-white/5 px-2 py-1 font-mono text-[10px] text-white/65"
              >
                <span className="truncate">
                  <span className="text-amber-300/80">{cell.region}</span> {cell.label}
                </span>
                <span className="shrink-0 text-white">{cell.cases}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          {!courtActive.length ? (
            <p className="border border-white/10 px-4 py-10 text-center font-mono text-[11px] text-white/35">
              Нет данных по судам
            </p>
          ) : (
            <div className="grid max-h-[280px] grid-cols-1 gap-2 overflow-auto sm:grid-cols-2">
              {courtActive.map((cell) => {
                const intensity = cell.cases / courtMax;
                return (
                  <div
                    key={cell.subdomain}
                    className="border border-white/10 p-3"
                    style={{
                      background: `rgba(56, 189, 248, ${0.06 + intensity * 0.35})`,
                      borderColor: `rgba(56, 189, 248, ${0.2 + intensity * 0.5})`,
                    }}
                    title={`${cell.name}: ${cell.cases} дел`}
                  >
                    <p className="font-mono text-[10px] text-sky-300/80">{cell.subdomain}</p>
                    <p className="mt-1 font-display text-xs uppercase leading-snug text-white">
                      {shortCourt(cell.name, cell.subdomain)}
                    </p>
                    <p className="mt-2 font-display text-2xl text-white">{cell.cases}</p>
                    <p className="font-mono text-[9px] text-white/40">дел в этом суде</p>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
