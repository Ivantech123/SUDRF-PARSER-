import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { MordoviaDashboard } from "../lib/api.js";
import { HelpTitle } from "./HelpTip.js";
import { ANALYTICS_HELP } from "../lib/analytics-help.js";

type RepSubtype = "representative" | "advocate" | "jurist" | "all";
type Heat = NonNullable<MordoviaDashboard["repHeatmaps"]>;

const LAYER_LABELS: Record<RepSubtype, string> = {
  all: "Все вместе",
  representative: "Представитель",
  advocate: "Адвокат",
  jurist: "Юрист",
};

const LAYER_HINT: Record<RepSubtype, string> = {
  all: "Любая роль из карточки: представитель, адвокат/защитник, юрист/юрисконсульт.",
  representative: "Роль на карточке содержит «представитель» (без адвоката и юриста).",
  advocate: "Роль «адвокат» или «защитник».",
  jurist: "Роль «юрист» или «юрисконсульт».",
};

function courtValue(cell: Heat["byCourt"][number], layer: RepSubtype): number {
  if (layer === "all") return cell.appearances;
  return cell.bySubtype[layer].appearances;
}

function courtPeople(cell: Heat["byCourt"][number], layer: RepSubtype): number {
  if (layer === "all") return cell.uniquePeople;
  return cell.bySubtype[layer].uniquePeople;
}

function shortName(name: string, subdomain: string): string {
  const cleaned = name
    .replace(/Республики Мордовия/gi, "РМ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 56) || subdomain;
}

export default function RepHeatmaps({ data }: { data: Heat }) {
  const [layer, setLayer] = useState<RepSubtype>("all");

  const maxCourt = useMemo(() => {
    return Math.max(1, ...data.byCourt.map((c) => courtValue(c, layer)));
  }, [data.byCourt, layer]);

  const matrixMax = useMemo(() => {
    let m = 1;
    for (const row of data.matrix.grid) {
      for (const v of row) if (v > m) m = v;
    }
    return m;
  }, [data.matrix.grid]);

  const activeCourts = useMemo(
    () => data.byCourt.filter((c) => courtValue(c, layer) > 0),
    [data.byCourt, layer],
  );

  return (
    <section className="space-y-8 border border-white/10 p-5">
      <header>
        <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-amber-400/70">
          Представители · адвокаты · юристы
        </p>
        <HelpTitle
          as="h2"
          className="mt-1 font-display text-xl uppercase text-white"
          helpTitle="Тепловые карты"
          help={ANALYTICS_HELP.repHeat}
        >
          Тепловые карты
        </HelpTitle>
        <p className="mt-3 max-w-3xl font-mono text-[12px] leading-relaxed text-white/50">
          Три взгляда на одни и те же данные с карточек дел Мордовии. Считаем появления ролей
          «представитель», «адвокат/защитник», «юрист/юрисконсульт». Чем ярче клетка — тем больше
          таких записей в этом суде. Уникальные ФИО — сколько разных людей, не сколько дел.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="border border-white/10 p-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-white/40">Всего появлений</p>
            <p className="mt-1 font-display text-2xl text-white">
              {data.totals.appearances.toLocaleString("ru-RU")}
            </p>
          </div>
          <div className="border border-white/10 p-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-white/40">Уникальных ФИО</p>
            <p className="mt-1 font-display text-2xl text-white">
              {data.totals.uniquePeople.toLocaleString("ru-RU")}
            </p>
          </div>
          <div className="border border-white/10 p-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-white/40">Адвокаты</p>
            <p className="mt-1 font-display text-2xl text-white">
              {data.totals.bySubtype.advocate.uniquePeople}
            </p>
            <p className="mt-1 font-mono text-[10px] text-white/35">
              {data.totals.bySubtype.advocate.appearances} появлений
            </p>
          </div>
          <div className="border border-white/10 p-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-white/40">Юристы</p>
            <p className="mt-1 font-display text-2xl text-white">
              {data.totals.bySubtype.jurist.uniquePeople}
            </p>
            <p className="mt-1 font-mono text-[10px] text-white/35">
              {data.totals.bySubtype.jurist.appearances} появлений
            </p>
          </div>
        </div>
      </header>

      {/* 1 + 2: by court with layer toggle */}
      <div>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="font-display text-sm uppercase text-white/90">1–2 · По судам Мордовии</h3>
            <p className="mt-1 max-w-2xl font-mono text-[11px] leading-relaxed text-white/40">
              Карта плотности: в каком суде чаще встречаются представители. Переключатель слоёв
              отделяет роль «представитель» от адвокатов и юристов — как написано на карточке дела.
            </p>
          </div>
          <p className="font-mono text-[10px] text-white/35">ярче = больше появлений</p>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {(Object.keys(LAYER_LABELS) as RepSubtype[]).map((id) => {
            const active = layer === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setLayer(id)}
                className={`border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] transition ${
                  active
                    ? "border-amber-400/70 bg-amber-400/10 text-amber-200"
                    : "border-white/15 text-white/50 hover:border-white/40 hover:text-white"
                }`}
                title={LAYER_HINT[id]}
              >
                {LAYER_LABELS[id]}
              </button>
            );
          })}
        </div>
        <p className="mb-4 font-mono text-[11px] text-white/45">{LAYER_HINT[layer]}</p>

        {!activeCourts.length ? (
          <p className="font-mono text-[11px] text-white/35">
            Пока нет данных по этому слою — дождитесь переразбора карточек дел.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {activeCourts.map((cell, i) => {
              const value = courtValue(cell, layer);
              const people = courtPeople(cell, layer);
              const intensity = value / maxCourt;
              return (
                <motion.div
                  key={`${layer}-${cell.subdomain}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.015, 0.35) }}
                  className="border border-white/10 p-3"
                  style={{ background: `rgba(251, 191, 36, ${0.04 + intensity * 0.28})` }}
                  title={`${cell.name}: ${value} появлений, ${people} уникальных ФИО`}
                >
                  <p className="font-mono text-[10px] text-amber-300/80">{cell.subdomain}</p>
                  <p className="mt-1 font-display text-sm uppercase leading-snug text-white">
                    {shortName(cell.name, cell.subdomain)}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-white/60">
                    <span>появлений {value}</span>
                    <span>ФИО {people}</span>
                    {layer === "all" ? (
                      <>
                        <span>предст. {cell.bySubtype.representative.appearances}</span>
                        <span>адвок. {cell.bySubtype.advocate.appearances}</span>
                        <span>юристы {cell.bySubtype.jurist.appearances}</span>
                      </>
                    ) : null}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3: people × courts matrix */}
      <div>
        <h3 className="font-display text-sm uppercase text-white/90">3 · Кто × где</h3>
        <p className="mt-1 max-w-3xl font-mono text-[11px] leading-relaxed text-white/40">
          Матрица: строки — самые частые представители/адвокаты/юристы по всему региону, столбцы —
          суды. Число в клетке — сколько раз это ФИО встретилось в делах данного суда. Пустая клетка —
          человек в этом суде не фигурировал.
        </p>

        {!data.matrix.people.length || !data.matrix.courts.length ? (
          <p className="mt-4 font-mono text-[11px] text-white/35">Матрица пока пуста.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-max min-w-full border-collapse text-left font-mono text-[10px] text-white/70">
              <thead>
                <tr className="border-b border-white/10 text-white/40">
                  <th className="sticky left-0 z-10 bg-black py-2 pr-3 font-normal">Участник</th>
                  <th className="py-2 pr-3 font-normal">всего</th>
                  {data.matrix.courts.map((col) => (
                    <th
                      key={col.subdomain}
                      className="max-w-[4.5rem] truncate px-1 py-2 font-normal"
                      title={col.subdomain}
                    >
                      {col.shortName}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.matrix.people.map((person, ri) => (
                  <tr key={person.id} className="border-b border-white/5">
                    <td className="sticky left-0 z-10 max-w-[12rem] truncate bg-black py-1.5 pr-3 text-white" title={person.name}>
                      {person.name}
                    </td>
                    <td className="py-1.5 pr-3 text-amber-200/80">{person.total}</td>
                    {data.matrix.courts.map((col, ci) => {
                      const v = data.matrix.grid[ri]?.[ci] ?? 0;
                      const intensity = v / matrixMax;
                      return (
                        <td
                          key={col.subdomain}
                          className="px-1 py-1.5 text-center"
                          style={{
                            background:
                              v > 0 ? `rgba(251, 191, 36, ${0.08 + intensity * 0.55})` : undefined,
                          }}
                          title={v > 0 ? `${person.name} · ${col.shortName}: ${v}` : undefined}
                        >
                          {v > 0 ? v : ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ul className="space-y-1 border-t border-white/10 pt-4 font-mono text-[10px] leading-relaxed text-white/35">
        {data.notes.map((n) => (
          <li key={n}>· {n}</li>
        ))}
      </ul>
    </section>
  );
}
