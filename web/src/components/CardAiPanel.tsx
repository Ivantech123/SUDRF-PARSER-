import { useState } from "react";
import {
  requestCardAi,
  type CardAiKind,
  type CardAiMode,
  type CardAiResult,
} from "../lib/api.js";
import HelpTip from "./HelpTip.js";
import SimpleMarkdown from "./SimpleMarkdown.js";

const MODES: Array<{ id: CardAiMode; label: string; hint: string }> = [
  { id: "profile", label: "Разбор", hint: "портрет по цифрам" },
  { id: "hints", label: "На что смотреть", hint: "риски и следующие шаги" },
  { id: "brief", label: "Справка", hint: "текст для заметки" },
];

export default function CardAiPanel({
  kind,
  id,
  name,
  role,
  disabled,
}: {
  kind: CardAiKind;
  id?: string;
  name?: string;
  role?: string;
  disabled?: boolean;
}) {
  const [loading, setLoading] = useState<CardAiMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CardAiResult | null>(null);

  const run = async (mode: CardAiMode) => {
    setLoading(mode);
    setError(null);
    try {
      const r = await requestCardAi({ kind, mode, id, name, role });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(null);
    }
  };

  return (
    <section className="border border-amber-400/25 bg-gradient-to-br from-amber-400/[0.06] to-transparent p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex flex-wrap items-center font-mono text-[10px] uppercase tracking-[0.25em] text-amber-300/70">
            <span>A2chatski</span>
            <HelpTip title="A2chatski">
              Три режима по агрегатам карточки: разбор, подсказки и готовая справка.
              В модель уходят только цифры и списки судов/категорий — не тексты актов.
              Это ориентир по каталогу, не юридическое заключение.
            </HelpTip>
          </p>
          <p className="mt-1 font-mono text-[11px] text-white/45">
            Полезные функции по этой карточке
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              title={m.hint}
              disabled={Boolean(disabled) || loading != null}
              onClick={() => void run(m.id)}
              className="border border-amber-400/50 bg-amber-400/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-amber-100 transition hover:bg-amber-400/20 disabled:opacity-50"
            >
              {loading === m.id ? "…" : m.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="mt-3 border border-red-400/30 bg-red-400/10 px-3 py-2 font-mono text-[11px] text-red-200">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-4 border-t border-white/10 pt-4">
          <p className="mb-3 font-mono text-[9px] uppercase tracking-[0.2em] text-white/35">
            {MODES.find((m) => m.id === result.mode)?.label ?? result.mode}
          </p>
          <SimpleMarkdown text={result.markdown} />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="font-mono text-[10px] text-white/30">
              {result.model} · {new Date(result.generatedAt).toLocaleString("ru-RU")}
            </p>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(result.markdown);
              }}
              className="font-mono text-[10px] uppercase tracking-wider text-amber-300/70 underline-offset-2 hover:underline"
            >
              Копировать
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
