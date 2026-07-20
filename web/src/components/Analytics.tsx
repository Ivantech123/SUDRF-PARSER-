import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { getMordoviaAnalytics, type MordoviaDashboard } from "../lib/api.js";
import RepHeatmaps from "./RepHeatmaps.js";
import AiInsightPanel from "./AiInsightPanel.js";
import HelpTip, { HelpTitle } from "./HelpTip.js";
import { ANALYTICS_HELP } from "../lib/analytics-help.js";
import { Link } from "./Router.js";
import SegmentTabs, { TabPanel } from "./SegmentTabs.js";

type AnalyticsTab = "overview" | "people" | "judges" | "season" | "money" | "more";

const ANALYTICS_TABS: Array<{ id: AnalyticsTab; label: string }> = [
  { id: "overview", label: "Обзор" },
  { id: "people", label: "Люди" },
  { id: "judges", label: "Судьи" },
  { id: "season", label: "Время" },
  { id: "money", label: "Исходы" },
  { id: "more", label: "Ещё" },
];

const OUTCOME_LABELS: Record<string, string> = {
  granted: "Удовлетворено",
  granted_partial: "Частично",
  denied: "Отказ",
  settled: "Мировое / отказ от иска",
  terminated: "Прекращено",
  returned: "Возвращено",
  appealed_upheld: "Без изменения",
  appealed_changed: "Отменено / изменено",
  unknown: "Неизвестно",
};

const KIND_LABEL: Record<string, string> = {
  bank: "банк",
  uk: "УК/ЖКХ",
  insurance: "страх",
  other: "прочее",
};

function pct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function days(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Math.round(n)} дн`;
}

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " ₽";
}

function Stat({
  label,
  value,
  hint,
  help,
  helpTitle,
}: {
  label: string;
  value: string | number;
  hint?: string;
  help?: ReactNode;
  helpTitle?: string;
}) {
  return (
    <div className="min-w-0 border border-white/10 p-3 md:p-4">
      <p className="flex flex-wrap items-center font-mono text-[8px] uppercase tracking-[0.15em] text-white/40 md:text-[9px] md:tracking-[0.2em]">
        <span>{label}</span>
        {help ? <HelpTip title={helpTitle ?? label}>{help}</HelpTip> : null}
      </p>
      <p className="mt-1.5 font-display text-xl text-white md:mt-2 md:text-2xl">{value}</p>
      {hint ? <p className="mt-1 line-clamp-2 font-mono text-[9px] text-white/35 md:text-[10px]">{hint}</p> : null}
    </div>
  );
}

function OutcomeBars({ byLabel }: { byLabel: Record<string, number> }) {
  const entries = Object.entries(byLabel).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return (
    <ul className="space-y-2">
      {entries.map(([k, n]) => (
        <li key={k}>
          <div className="flex justify-between gap-2 font-mono text-[11px] text-white/70">
            <span>{OUTCOME_LABELS[k] ?? k}</span>
            <span>{n}</span>
          </div>
          <div className="mt-1 h-1.5 bg-white/5">
            <div className="h-full bg-amber-400/70" style={{ width: `${(n / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function MiniBars({
  items,
  valueKey,
}: {
  items: Array<{ label: string; value: number; sub?: string }>;
  valueKey?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={`${i.label}-${valueKey ?? ""}`}>
          <div className="flex justify-between gap-2 font-mono text-[11px] text-white/70">
            <span>{i.label}{i.sub ? <span className="text-white/35"> · {i.sub}</span> : null}</span>
            <span>{i.value}</span>
          </div>
          <div className="mt-1 h-1.5 bg-white/5">
            <div className="h-full bg-amber-400/70" style={{ width: `${(i.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function Analytics() {
  const [data, setData] = useState<MordoviaDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<AnalyticsTab>("overview");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const d = await getMordoviaAnalytics();
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const t = setInterval(() => void load(), 30000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const maxHeat = useMemo(
    () => Math.max(1, ...(data?.courtHeatmap.map((c) => c.total) ?? [1])),
    [data],
  );

  const slowJudges = useMemo(() => {
    const j = data?.deep?.judges ?? [];
    return [...j]
      .filter((x) => x.withDuration >= 3 && x.medianDays != null)
      .sort((a, b) => (b.medianDays ?? 0) - (a.medianDays ?? 0))
      .slice(0, 12);
  }, [data]);

  const fastJudges = useMemo(() => {
    const j = data?.deep?.judges ?? [];
    return [...j]
      .filter((x) => x.withDuration >= 3 && x.medianDays != null)
      .sort((a, b) => (a.medianDays ?? 0) - (b.medianDays ?? 0))
      .slice(0, 12);
  }, [data]);

  const overturnJudges = useMemo(() => {
    const j = data?.deep?.judges ?? [];
    return [...j]
      .filter((x) => x.appealReviewed >= 3)
      .sort((a, b) => (b.appealChangeRate ?? 0) - (a.appealChangeRate ?? 0))
      .slice(0, 15);
  }, [data]);

  const bankBiasJudges = useMemo(() => {
    const j = data?.deep?.judges ?? [];
    return [...j]
      .filter((x) => x.bankCases >= 3)
      .sort((a, b) => (b.bankFavorRate ?? 0) - (a.bankFavorRate ?? 0))
      .slice(0, 15);
  }, [data]);

  if (loading && !data) {
    return (
      <main className="page-shell">
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-white/40">Считаем аналитику…</p>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className="page-shell">
        <p className="font-mono text-sm text-red-300">{error}</p>
      </main>
    );
  }

  if (!data) return null;

  const { totals, depersonalization: dep, outcomes, winrate, deep } = data;
  const maxSeason = Math.max(1, ...deep.seasonality.map((m) => m.total));

  return (
    <main className="page-shell">
      <div className="mx-auto min-w-0 max-w-7xl space-y-6 md:space-y-10">
        <header>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-amber-400/70">Сводка · регион 13</p>
          <h1 className="mt-1 font-display text-2xl uppercase text-white md:mt-2 md:text-4xl">
            {data.regionLabel}
          </h1>
          <p className="mt-2 hidden max-w-3xl font-mono text-[12px] leading-relaxed text-white/50 md:block">
            Судейский корпус, сезонность, экономика актов, аномалии — по каталогу дел Мордовии.
            Считается заново при каждом обновлении страницы.
            Обновлено {new Date(data.generatedAt).toLocaleString("ru-RU")}.
            {!data.professionals.indexReady ? " Карточки юристов ещё собираются…" : ""}
          </p>
          <p className="mt-1.5 font-mono text-[11px] text-white/40">
            <Link to="/methodology" className="text-amber-300/80 underline-offset-2 hover:underline">
              Методика
            </Link>
            <span className="text-white/25"> · </span>
            {new Date(data.generatedAt).toLocaleDateString("ru-RU")}
          </p>
        </header>

        <div className="md:hidden">
          <SegmentTabs tabs={ANALYTICS_TABS} value={tab} onChange={setTab} sticky />
        </div>

        <TabPanel active={tab === "overview"} className="space-y-4 md:space-y-8">
          <div className="md:block">
            <AiInsightPanel />
          </div>

        <section className="grid grid-cols-2 gap-2 md:gap-3 lg:grid-cols-4">
          <Stat
            label="В каталоге"
            value={totals.catalog.toLocaleString("ru-RU")}
            hint="все собранные дела региона"
          />
          <Stat
            label="С полными карточками"
            value={totals.enriched.toLocaleString("ru-RU")}
            hint={`с текстом акта: ${totals.withActText} · ещё в очереди: ${totals.pendingEnrich}`}
          />
          <Stat
            label="Первая инстанция"
            value={totals.firstInstance.toLocaleString("ru-RU")}
            hint="номера вида 2-* / 2а-*"
          />
          <Stat
            label="Срок дела (середина)"
            value={days(deep.lifecycle.medianDays)}
            hint={`дел: ${deep.lifecycle.sampleSize} · четверть–три четверти ${days(deep.lifecycle.p25Days)}–${days(deep.lifecycle.p75Days)}`}
          />
          <Stat
            label="Доля взысканного"
            value={pct(deep.amounts.medianConversion)}
            hint={`пар иск/взыскание: ${deep.amounts.casesWithBoth}`}
            helpTitle="Доля взысканного"
            help={ANALYTICS_HELP.conversion}
          />
          <Stat
            label="ФИО в актах (1 инст.)"
            value={pct(dep.firstInstance.identifiableRate)}
            hint={`оценка: ${
              dep.firstInstance.goNoGo === "go"
                ? "достаточно ФИО"
                : dep.firstInstance.goNoGo === "borderline"
                  ? "на грани"
                  : dep.firstInstance.goNoGo === "no-go"
                    ? "мало ФИО"
                    : "мало актов"
            }`}
            helpTitle="ФИО в актах"
            help={ANALYTICS_HELP.fioInActs}
          />
          <Stat
            label="Исходы известны"
            value={`${outcomes.firstInstance.known}/${outcomes.firstInstance.total}`}
            hint="первая инстанция"
            helpTitle="Исходы"
            help={ANALYTICS_HELP.outcomes}
          />
          <Stat
            label="«Зависшие» без исхода"
            value={deep.stuckUnknown.length}
            hint="с поступления прошло ≥ 60 дней"
            helpTitle="Зависшие без исхода"
            help={ANALYTICS_HELP.stuck}
          />
        </section>
        </TabPanel>

        <TabPanel active={tab === "people"} className="space-y-4 md:space-y-8">
        {data.participants ? (
          <section className="border border-white/10 p-4 md:p-5">
            <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-amber-400/70">Участники</p>
            <HelpTitle
              as="h2"
              className="mt-1 font-display text-xl uppercase text-white"
              helpTitle="Участники"
              help={ANALYTICS_HELP.participants}
            >
              Представитель и стороны
            </HelpTitle>
            <p className="mt-2 max-w-3xl font-mono text-[11px] leading-relaxed text-white/40">
              Уникальные ФИО из блока «стороны / участники» на карточке дела. Представители здесь —
              все роли «представитель», «адвокат», «юрист» вместе; ниже — отдельные тепловые карты по слоям.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <Stat label="Представители" value={data.participants.representatives} hint="уникальные ФИО" />
              <Stat label="Истцы" value={data.participants.plaintiffs} />
              <Stat label="Ответчики" value={data.participants.defendants} />
              <Stat label="Третьи лица" value={data.participants.third} />
            </div>
            <div className="mt-6 scroll-x">
              <table className="w-full min-w-[480px] text-left font-mono text-[11px] text-white/70">
                <thead className="text-white/35">
                  <tr className="border-b border-white/10">
                    <th className="py-1 pr-2 font-normal">ПРЕДСТАВИТЕЛЬ</th>
                    <th className="py-1 pr-2 font-normal">дел</th>
                    <th className="py-1 pr-2 font-normal">судов</th>
                    <th className="py-1 font-normal">акты</th>
                  </tr>
                </thead>
                <tbody>
                  {data.participants.topRepresentatives.map((r) => (
                    <tr key={r.name} className="border-b border-white/5">
                      <td className="py-1.5 pr-2 text-white">{r.name}</td>
                      <td className="py-1.5 pr-2">{r.cases}</td>
                      <td className="py-1.5 pr-2">{r.courts}</td>
                      <td className="py-1.5">{r.withActs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {data.repHeatmaps ? <RepHeatmaps data={data.repHeatmaps} /> : null}
        </TabPanel>

        {/* 1. Judges */}
        <TabPanel active={tab === "judges"} className="space-y-4 md:space-y-8">
        <section className="border border-white/10 p-4 md:p-5">
          <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-amber-400/70">1 · Судейский корпус</p>
          <HelpTitle
            as="h2"
            className="mt-1 font-display text-xl uppercase text-white"
            helpTitle="Судейский корпус"
            help={ANALYTICS_HELP.judges}
          >
            Скорость · отмены · банки
          </HelpTitle>
          <p className="mt-2 max-w-3xl font-mono text-[11px] leading-relaxed text-white/40">
            Кратко: как быстро судья ведёт дела, как часто решения трогают в апелляции, и как
            выглядят банковские иски. Нажмите «?» у заголовка — полный разбор методики.
          </p>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div>
              <HelpTitle
                as="h3"
                className="font-display text-sm uppercase text-white/80"
                helpTitle="Медленные судьи"
                help={ANALYTICS_HELP.slowJudges}
              >
                Медленные (середина срока)
              </HelpTitle>
              <div className="mt-3 scroll-x">
                <table className="w-full text-left font-mono text-[11px] text-white/70">
                  <thead className="text-white/35">
                    <tr className="border-b border-white/10">
                      <th className="py-1 pr-2 font-normal">Судья</th>
                      <th className="py-1 pr-2 font-normal">середина</th>
                      <th className="py-1 pr-2 font-normal">медл. четверть</th>
                      <th className="py-1 font-normal">дел</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slowJudges.map((j) => (
                      <tr key={`slow-${j.name}`} className="border-b border-white/5">
                        <td className="py-1.5 pr-2 text-white">{j.name}</td>
                        <td className="py-1.5 pr-2 text-amber-300/90">{days(j.medianDays)}</td>
                        <td className="py-1.5 pr-2">{days(j.p75Days)}</td>
                        <td className="py-1.5">{j.withDuration}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!slowJudges.length ? (
                  <p className="mt-2 font-mono text-[11px] text-white/35">Мало дат entry/result — копим.</p>
                ) : null}
              </div>
            </div>
            <div>
              <HelpTitle
                as="h3"
                className="font-display text-sm uppercase text-white/80"
                helpTitle="Быстрые судьи"
                help={ANALYTICS_HELP.fastJudges}
              >
                Быстрые (середина срока)
              </HelpTitle>
              <div className="mt-3 scroll-x">
                <table className="w-full text-left font-mono text-[11px] text-white/70">
                  <thead className="text-white/35">
                    <tr className="border-b border-white/10">
                      <th className="py-1 pr-2 font-normal">Судья</th>
                      <th className="py-1 pr-2 font-normal">середина</th>
                      <th className="py-1 pr-2 font-normal">медл. четверть</th>
                      <th className="py-1 font-normal">дел</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fastJudges.map((j) => (
                      <tr key={`fast-${j.name}`} className="border-b border-white/5">
                        <td className="py-1.5 pr-2 text-white">{j.name}</td>
                        <td className="py-1.5 pr-2 text-emerald-300/80">{days(j.medianDays)}</td>
                        <td className="py-1.5 pr-2">{days(j.p75Days)}</td>
                        <td className="py-1.5">{j.withDuration}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <div>
              <HelpTitle
                as="h3"
                className="font-display text-sm uppercase text-white/80"
                helpTitle="Отмены в апелляции"
                help={ANALYTICS_HELP.overturn}
              >
                Доля отмен / изменений в апелляции
              </HelpTitle>
              <div className="mt-3 scroll-x">
                <table className="w-full text-left font-mono text-[11px] text-white/70">
                  <thead className="text-white/35">
                    <tr className="border-b border-white/10">
                      <th className="py-1 pr-2 font-normal">Судья (1 инст.)</th>
                      <th className="py-1 pr-2 font-normal">доля отмен</th>
                      <th className="py-1 font-normal">изм./всего</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overturnJudges.map((j) => (
                      <tr key={`ov-${j.name}`} className="border-b border-white/5">
                        <td className="py-1.5 pr-2 text-white">{j.name}</td>
                        <td className="py-1.5 pr-2 text-amber-300/90">{pct(j.appealChangeRate)}</td>
                        <td className="py-1.5">
                          {j.appealChanged}/{j.appealReviewed}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!overturnJudges.length ? (
                  <p className="mt-2 font-mono text-[11px] text-white/35">Пока мало 11-* с исходом.</p>
                ) : null}
              </div>
            </div>
            <div>
              <HelpTitle
                as="h3"
                className="font-display text-sm uppercase text-white/80"
                helpTitle="Банки как истцы"
                help={ANALYTICS_HELP.banks}
              >
                Банки как истцы → доля удовлетворений
              </HelpTitle>
              <div className="mt-3 scroll-x">
                <table className="w-full text-left font-mono text-[11px] text-white/70">
                  <thead className="text-white/35">
                    <tr className="border-b border-white/10">
                      <th className="py-1 pr-2 font-normal">Судья</th>
                      <th className="py-1 pr-2 font-normal">доля удовл.</th>
                      <th className="py-1 font-normal">дел банк</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bankBiasJudges.map((j) => (
                      <tr key={`bank-${j.name}`} className="border-b border-white/5">
                        <td className="py-1.5 pr-2 text-white">{j.name}</td>
                        <td className="py-1.5 pr-2">{pct(j.bankFavorRate)}</td>
                        <td className="py-1.5">
                          {j.bankFavorable}/{j.bankCases}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!bankBiasJudges.length ? (
                  <p className="mt-2 font-mono text-[11px] text-white/35">Мало дел с банком-истцом и известным исходом.</p>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        </TabPanel>

        {/* 2. Temporal */}
        <TabPanel active={tab === "season"} className="space-y-4 md:space-y-8">
        <section className="border border-white/10 p-4 md:p-5">
          <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-amber-400/70">2 · Время</p>
          <HelpTitle
            as="h2"
            className="mt-1 font-display text-xl uppercase text-white"
            helpTitle="Сезонность и срок дела"
            help={ANALYTICS_HELP.lifecycle}
          >
            Сезонность и жизненный цикл
          </HelpTitle>
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <Stat
              label="Середина срока"
              value={days(deep.lifecycle.medianDays)}
              hint="поступление → акт/результат"
              helpTitle="Середина срока"
              help={ANALYTICS_HELP.lifecycle}
            />
            <Stat label="Быстрая четверть" value={days(deep.lifecycle.p25Days)} hint="25% дел быстрее" />
            <Stat label="Медленная четверть" value={days(deep.lifecycle.p75Days)} hint="25% дел дольше" />
            <Stat label="Среднее" value={days(deep.lifecycle.meanDays)} hint={`дел: ${deep.lifecycle.sampleSize}`} />
          </div>
          <div className="mt-6">
            <HelpTitle
              as="h3"
              className="font-display text-sm uppercase text-white/80"
              helpTitle="Сезонность"
              help={ANALYTICS_HELP.seasonality}
            >
              Всплески по месяцу поступления (1 инст.)
            </HelpTitle>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {deep.seasonality.map((m) => (
                <div
                  key={m.month}
                  className="border border-white/10 p-3"
                  style={{ background: `rgba(251, 191, 36, ${0.03 + (m.total / maxSeason) * 0.25})` }}
                >
                  <p className="font-mono text-[10px] uppercase text-amber-300/80">{m.label}</p>
                  <p className="mt-1 font-display text-xl text-white">{m.total}</p>
                  <ul className="mt-2 space-y-0.5 font-mono text-[9px] text-white/45">
                    <li>ЖКХ {m.communal}</li>
                    <li>брак {m.divorce}</li>
                    <li>ДТП {m.dtp}</li>
                    <li>кредит {m.credit}</li>
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        </TabPanel>

        {/* 3. Economics + outcomes */}
        <TabPanel active={tab === "money"} className="space-y-4 md:space-y-8">
        <section className="border border-white/10 p-4 md:p-5">
          <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-amber-400/70">3 · Экономика</p>
          <HelpTitle
            as="h2"
            className="mt-1 font-display text-xl uppercase text-white"
            helpTitle="Суммы и серийные истцы"
            help={ANALYTICS_HELP.amounts}
          >
            Суммы и серийные истцы
          </HelpTitle>
          <p className="mt-2 font-mono text-[11px] text-white/40">
            Суммы из текста актов; возможны ошибки. «?» — как именно считаем.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Середина иска"
              value={money(deep.amounts.medianClaim)}
              hint={`дел: ${deep.amounts.casesWithClaim}`}
              helpTitle="Суммы"
              help={ANALYTICS_HELP.amounts}
            />
            <Stat label="Середина взыскания" value={money(deep.amounts.medianAward)} hint={`дел: ${deep.amounts.casesWithAward}`} />
            <Stat
              label="Доля взысканного (середина)"
              value={pct(deep.amounts.medianConversion)}
              hint={`пар: ${deep.amounts.casesWithBoth}`}
              helpTitle="Доля взысканного"
              help={ANALYTICS_HELP.conversion}
            />
            <Stat
              label="Сумма взысканий / сумма исков"
              value={
                deep.amounts.totalClaim > 0
                  ? pct(deep.amounts.totalAward / deep.amounts.totalClaim)
                  : "—"
              }
            />
          </div>
          <div className="mt-6">
            <HelpTitle
              as="h3"
              className="font-display text-sm uppercase text-white/80"
              helpTitle="Серийные истцы"
              help={ANALYTICS_HELP.serialPlaintiffs}
            >
              Серийные истцы
            </HelpTitle>
            <div className="mt-3 scroll-x">
              <table className="w-full min-w-[640px] text-left font-mono text-[11px] text-white/70">
                <thead className="text-white/35">
                  <tr className="border-b border-white/10">
                    <th className="py-2 pr-3 font-normal">Истец</th>
                    <th className="py-2 pr-3 font-normal">тип</th>
                    <th className="py-2 pr-3 font-normal">дел</th>
                    <th className="py-2 pr-3 font-normal">побед/отказов</th>
                    <th className="py-2 font-normal">успех %</th>
                  </tr>
                </thead>
                <tbody>
                  {deep.serialPlaintiffs.map((p) => (
                    <tr key={p.name} className="border-b border-white/5">
                      <td className="max-w-[280px] truncate py-2 pr-3 text-white" title={p.name}>
                        {p.name}
                      </td>
                      <td className="py-2 pr-3 text-amber-300/70">{KIND_LABEL[p.kind] ?? p.kind}</td>
                      <td className="py-2 pr-3">{p.cases}</td>
                      <td className="py-2 pr-3">
                        {p.wins}/{p.losses}
                      </td>
                      <td className="py-2">{pct(p.winRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!deep.serialPlaintiffs.length ? (
              <p className="mt-3 font-mono text-[11px] text-white/35">Серийных истцов (≥4 дел) пока нет в выборке.</p>
            ) : null}
          </div>
        </section>

        <section id="an-outcomes" className="grid gap-4 md:gap-6 lg:grid-cols-2">
          <div className="border border-white/10 p-4 md:p-5">
            <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-white/40">Исходы</p>
            <HelpTitle
              as="h3"
              className="mt-1 font-display text-lg text-white"
              helpTitle="Исходы дел"
              help={ANALYTICS_HELP.outcomes}
            >
              Первая инстанция
            </HelpTitle>
            <div className="mt-4">
              <OutcomeBars byLabel={outcomes.firstInstance.byLabel} />
            </div>
          </div>
          <div className="border border-white/10 p-4 md:p-5">
            <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-white/40">Исходы</p>
            <HelpTitle
              as="h3"
              className="mt-1 font-display text-lg text-white"
              helpTitle="Исходы дел"
              help={ANALYTICS_HELP.outcomes}
            >
              Все с полными карточками
            </HelpTitle>
            <div className="mt-4">
              <OutcomeBars byLabel={outcomes.allEnriched.byLabel} />
            </div>
          </div>
        </section>
        </TabPanel>

        {/* 4. Anomalies + rest */}
        <TabPanel active={tab === "more"} className="space-y-4 md:space-y-8">
        <section className="border border-white/10 p-4 md:p-5">
          <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-amber-400/70">4 · Аномалии</p>
          <HelpTitle
            as="h2"
            className="mt-1 font-display text-xl uppercase text-white"
            helpTitle="Аномалии"
            help={
              <>
                {ANALYTICS_HELP.stuck}
                {ANALYTICS_HELP.practiceShift}
              </>
            }
          >
            Зависшие без исхода и сдвиг практики
          </HelpTitle>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div>
              <HelpTitle
                as="h3"
                className="font-display text-sm uppercase text-white/80"
                helpTitle="Долго без исхода"
                help={ANALYTICS_HELP.stuck}
              >
                Долго без исхода (≥60 дн)
              </HelpTitle>
              <ul className="mt-3 max-h-96 space-y-2 overflow-auto font-mono text-[11px] text-white/65">
                {deep.stuckUnknown.map((c) => (
                  <li key={`${c.court}-${c.caseNumber}`} className="border-b border-white/5 pb-1">
                    <span className="text-amber-300/80">{c.court}</span>{" "}
                    <span className="text-white">{c.caseNumber}</span>{" "}
                    <span className="text-white/40">{c.ageDays != null ? `${c.ageDays}д` : "?"}</span>
                    {c.judge ? <span className="text-white/35"> · {c.judge}</span> : null}
                  </li>
                ))}
              </ul>
              {!deep.stuckUnknown.length ? (
                <p className="mt-2 font-mono text-[11px] text-white/35">Зависших не видно — или мало дат поступления.</p>
              ) : null}
            </div>
            <div>
              <HelpTitle
                as="h3"
                className="font-display text-sm uppercase text-white/80"
                helpTitle="Сдвиг практики"
                help={ANALYTICS_HELP.practiceShift}
              >
                Доля удовлетворений по месяцам
              </HelpTitle>
              <ul className="mt-3 max-h-96 space-y-2 overflow-auto">
                {deep.practiceShift.map((m) => (
                  <li key={m.ym}>
                    <div className="flex justify-between gap-2 font-mono text-[11px] text-white/70">
                      <span>{m.ym}</span>
                      <span>
                        {pct(m.grantedRate)} · дел {m.known}/{m.total}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 bg-white/5">
                      <div
                        className="h-full bg-amber-400/70"
                        style={{ width: `${Math.max(2, (m.grantedRate ?? 0) * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
              {!deep.practiceShift.length ? (
                <p className="mt-2 font-mono text-[11px] text-white/35">Нужны даты и известные исходы.</p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="border border-white/10 p-5">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-amber-400/70">Карта судов</p>
              <HelpTitle
                as="h2"
                className="mt-1 font-display text-xl uppercase text-white"
                helpTitle="Плотность дел"
                help={ANALYTICS_HELP.courtHeat}
              >
                Плотность дел
              </HelpTitle>
              <p className="mt-2 max-w-2xl font-mono text-[11px] leading-relaxed text-white/40">
                Сколько дел лежит в каталоге по каждому суду. «?» — расшифровка всех подписей в клетке.
              </p>
            </div>
            <p className="font-mono text-[10px] text-white/35">ярче = больше дел в каталоге</p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.courtHeatmap.map((cell, i) => {
              const intensity = cell.total / maxHeat;
              return (
                <motion.div
                  key={cell.subdomain}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02 }}
                  className="border border-white/10 p-3"
                  style={{
                    background: `rgba(251, 191, 36, ${0.04 + intensity * 0.22})`,
                  }}
                >
                  <p className="font-mono text-[10px] text-amber-300/80">{cell.subdomain}</p>
                  <p className="mt-1 font-display text-sm uppercase leading-snug text-white">
                    {cell.name.replace(/Республики Мордовия/i, "РМ").slice(0, 70)}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-white/60">
                    <span>всего {cell.total}</span>
                    <span>с карточкой {cell.enriched}</span>
                    <span>акты {cell.withActText}</span>
                    <span>1 инст. {cell.firstInstance}</span>
                    <span>апел. {cell.appealLike}</span>
                    <span>ФИО в актах {cell.identifiableReps}</span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </section>

        <section className="grid gap-4 md:gap-6 lg:grid-cols-2">
          <div className="border border-white/10 p-4 md:p-5">
            <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-white/40">Категории</p>
            <h3 className="mt-1 font-display text-lg text-white">Топ споров</h3>
            <ul className="mt-4 max-h-80 space-y-2 overflow-auto font-mono text-[11px] text-white/70">
              {data.topCategories.map((c) => (
                <li key={c.name} className="flex justify-between gap-4 border-b border-white/5 pb-1">
                  <span className="truncate">{c.name}</span>
                  <span className="shrink-0">{c.count}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="border border-white/10 p-4 md:p-5">
            <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-white/40">Префиксы</p>
            <h3 className="mt-1 font-display text-lg text-white">Структура выборки</h3>
            <div className="mt-4">
              <MiniBars
                items={Object.entries(data.prefixes)
                  .sort((a, b) => b[1] - a[1])
                  .map(([p, n]) => ({ label: `${p}-*`, value: n }))}
              />
            </div>
          </div>
        </section>

        <section className="border border-white/10 p-4 md:p-5">
          <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-amber-400/70">Доля побед</p>
          <HelpTitle
            as="h2"
            className="mt-1 font-display text-xl uppercase text-white"
            helpTitle="Доля побед представителей"
            help={ANALYTICS_HELP.winrate}
          >
            Представители (1 инстанция)
          </HelpTitle>
          <p className="mt-2 max-w-3xl font-mono text-[11px] leading-relaxed text-white/40">{winrate.caveat}</p>
          <div className="mt-4 scroll-x">
            <table className="w-full min-w-[640px] text-left font-mono text-[11px] text-white/70">
              <thead className="text-white/40">
                <tr className="border-b border-white/10">
                  <th className="py-2 pr-3 font-normal">Представитель</th>
                  <th className="py-2 pr-3 font-normal">дел</th>
                  <th className="py-2 pr-3 font-normal">побед/отказов</th>
                  <th className="py-2 pr-3 font-normal">успех %</th>
                  <th className="py-2 font-normal">примеры</th>
                </tr>
              </thead>
              <tbody>
                {winrate.leaders.slice(0, 25).map((r) => (
                  <tr key={r.name} className="border-b border-white/5">
                    <td className="py-2 pr-3 text-white">{r.name}</td>
                    <td className="py-2 pr-3">{r.cases}</td>
                    <td className="py-2 pr-3">
                      {r.wins}/{r.losses}
                    </td>
                    <td className="py-2 pr-3">{r.winRate == null ? "—" : pct(r.winRate)}</td>
                    <td className="py-2 text-white/40">{r.sampleCaseNumbers.slice(0, 3).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="border border-white/10 p-4 md:p-5">
          <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-white/40">Лента</p>
          <h3 className="mt-1 font-display text-lg text-white">Недавно обновлённые карточки</h3>
          <ul className="mt-4 space-y-2 font-mono text-[11px] text-white/65">
            {data.recentEnriched.map((c) => (
              <li key={`${c.court}-${c.caseNumber}-${c.enrichedAt}`} className="flex flex-wrap gap-x-4 border-b border-white/5 pb-1">
                <span className="text-amber-300/80">{c.court}</span>
                <span className="text-white">{c.caseNumber}</span>
                <span>{c.hasActText ? "есть акт" : "без акта"}</span>
                <span className="text-white/40">{(c.status ?? "").slice(0, 60)}</span>
              </li>
            ))}
          </ul>
        </section>
        </TabPanel>
      </div>
    </main>
  );
}
