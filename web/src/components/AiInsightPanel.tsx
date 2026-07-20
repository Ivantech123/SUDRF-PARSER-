import { useState } from "react";
import { requestMordoviaInsights, type AiInsightResult } from "../lib/api.js";
import HelpTip from "./HelpTip.js";
import SimpleMarkdown from "./SimpleMarkdown.js";

export default function AiInsightPanel() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiInsightResult | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await requestMordoviaInsights();
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="border border-amber-400/25 bg-gradient-to-br from-amber-400/[0.06] to-transparent p-4 md:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 max-w-2xl">
          <p className="flex flex-wrap items-center font-mono text-[10px] uppercase tracking-[0.25em] text-amber-300/70">
            <span>ИИ-инсайт</span>
            <HelpTip title="ИИ-инсайт">
              Краткий разбор сводки аналитики через A2chatski. Модель видит только
              сжатые цифры дашборда — не тексты дел и не персональные данные из актов.
              Это ориентир по выборке, не юридическое заключение.
            </HelpTip>
          </p>
          <h2 className="mt-1.5 font-display text-xl uppercase text-white md:mt-2 md:text-2xl">
            Что видно в цифрах
          </h2>
          <p className="mt-1.5 hidden font-mono text-[11px] text-white/45 md:mt-2 md:block">
            A2chatski сжимает текущую аналитику Мордовии в выводы, риски и следующие шаги.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={loading}
          className="w-full border border-amber-400/50 bg-amber-400/10 px-4 py-3 font-mono text-[11px] uppercase tracking-[0.2em] text-amber-100 transition disabled:opacity-50 sm:w-auto sm:py-2"
        >
          {loading ? "Считаем…" : result ? "Обновить" : "Сгенерировать"}
        </button>
      </div>

      {error ? (
        <p className="mt-4 border border-red-400/30 bg-red-400/10 px-3 py-2 font-mono text-[11px] text-red-200">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-5 border-t border-white/10 pt-5">
          <SimpleMarkdown text={result.markdown} />
          <p className="mt-4 font-mono text-[10px] text-white/30">
            {result.model} · {new Date(result.generatedAt).toLocaleString("ru-RU")}
          </p>
        </div>
      ) : null}
    </section>
  );
}
