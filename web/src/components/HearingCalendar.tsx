// Month calendar + from/to date inputs for hearing-date filters.

import { useMemo, useState } from "react";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function toIso(y: number, m0: number, d: number): string {
  return `${y}-${pad(m0 + 1)}-${pad(d)}`;
}

function parseIso(iso: string): { y: number; m0: number; d: number } | null {
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { y: Number(m[1]), m0: Number(m[2]) - 1, d: Number(m[3]) };
}

function cmpIso(a: string, b: string): number {
  return a.localeCompare(b);
}

interface Props {
  hearingFrom: string;
  hearingTo: string;
  onChange: (patch: { hearingFrom?: string; hearingTo?: string }) => void;
}

export default function HearingCalendar({ hearingFrom, hearingTo, onChange }: Props) {
  const today = useMemo(() => {
    const n = new Date();
    return { y: n.getFullYear(), m0: n.getMonth() };
  }, []);
  const seed = parseIso(hearingFrom) ?? parseIso(hearingTo);
  const [viewY, setViewY] = useState(seed?.y ?? today.y);
  const [viewM0, setViewM0] = useState(seed?.m0 ?? today.m0);
  const [pickMode, setPickMode] = useState<"from" | "range">("from");

  const cells = useMemo(() => {
    const first = new Date(viewY, viewM0, 1);
    // Monday-first: JS getDay() Sun=0 → shift
    const startPad = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(viewY, viewM0 + 1, 0).getDate();
    const out: Array<{ iso: string; day: number; inMonth: boolean } | null> = [];
    for (let i = 0; i < startPad; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      out.push({ iso: toIso(viewY, viewM0, d), day: d, inMonth: true });
    }
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [viewY, viewM0]);

  const prevMonth = () => {
    if (viewM0 === 0) {
      setViewY((y) => y - 1);
      setViewM0(11);
    } else setViewM0((m) => m - 1);
  };
  const nextMonth = () => {
    if (viewM0 === 11) {
      setViewY((y) => y + 1);
      setViewM0(0);
    } else setViewM0((m) => m + 1);
  };

  const onDayClick = (iso: string) => {
    if (pickMode === "from" || !hearingFrom) {
      onChange({ hearingFrom: iso, hearingTo: iso });
      setPickMode("range");
      return;
    }
    if (cmpIso(iso, hearingFrom) < 0) {
      onChange({ hearingFrom: iso, hearingTo: hearingFrom });
    } else {
      onChange({ hearingTo: iso });
    }
    setPickMode("from");
  };

  const inRange = (iso: string) => {
    if (!hearingFrom && !hearingTo) return false;
    const from = hearingFrom || hearingTo;
    const to = hearingTo || hearingFrom;
    if (!from || !to) return false;
    return cmpIso(iso, from) >= 0 && cmpIso(iso, to) <= 0;
  };
  const isEdge = (iso: string) => iso === hearingFrom || iso === hearingTo;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[8rem] flex-1">
          <label htmlFor="f-hearing-from" className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.15em] text-white/40">
            Дата с
          </label>
          <input
            id="f-hearing-from"
            type="date"
            value={hearingFrom}
            onChange={(e) => {
              const v = e.target.value;
              const to = hearingTo && v && cmpIso(hearingTo, v) < 0 ? v : hearingTo;
              onChange({ hearingFrom: v, hearingTo: to || v });
              const p = parseIso(v);
              if (p) {
                setViewY(p.y);
                setViewM0(p.m0);
              }
            }}
            className="w-full min-w-0 border border-white/15 bg-black px-3 py-2.5 font-mono text-[13px] text-white outline-none focus:border-white/60"
          />
        </div>
        <div className="min-w-[8rem] flex-1">
          <label htmlFor="f-hearing-to" className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.15em] text-white/40">
            Дата по
          </label>
          <input
            id="f-hearing-to"
            type="date"
            value={hearingTo}
            onChange={(e) => {
              const v = e.target.value;
              const from = hearingFrom && v && cmpIso(v, hearingFrom) < 0 ? v : hearingFrom;
              onChange({ hearingFrom: from || v, hearingTo: v });
            }}
            className="w-full min-w-0 border border-white/15 bg-black px-3 py-2.5 font-mono text-[13px] text-white outline-none focus:border-white/60"
          />
        </div>
        {(hearingFrom || hearingTo) && (
          <button
            type="button"
            onClick={() => {
              onChange({ hearingFrom: "", hearingTo: "" });
              setPickMode("from");
            }}
            className="border border-white/20 px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-white/50 hover:border-white hover:text-white"
          >
            Сброс дат
          </button>
        )}
      </div>

      <div className="border border-white/10 p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={prevMonth}
            className="border border-white/15 px-2 py-1 font-mono text-[11px] text-white/60 hover:border-white/40 hover:text-white"
          >
            ←
          </button>
          <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-white/70">
            {MONTHS[viewM0]} {viewY}
          </p>
          <button
            type="button"
            onClick={nextMonth}
            className="border border-white/15 px-2 py-1 font-mono text-[11px] text-white/60 hover:border-white/40 hover:text-white"
          >
            →
          </button>
        </div>
        <p className="mb-2 font-mono text-[9px] text-white/35">
          Клик — день; второй клик — конец периода
        </p>
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-1 text-center font-mono text-[9px] text-white/35">
              {w}
            </div>
          ))}
          {cells.map((cell, i) => {
            if (!cell) {
              return <div key={`e-${i}`} className="aspect-square" />;
            }
            const selected = inRange(cell.iso);
            const edge = isEdge(cell.iso);
            return (
              <button
                key={cell.iso}
                type="button"
                onClick={() => onDayClick(cell.iso)}
                className={`aspect-square font-mono text-[11px] transition ${
                  edge
                    ? "bg-amber-400 text-black"
                    : selected
                      ? "bg-amber-400/25 text-amber-100"
                      : "text-white/70 hover:bg-white/10"
                }`}
              >
                {cell.day}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
