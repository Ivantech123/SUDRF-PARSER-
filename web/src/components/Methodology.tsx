import { METHODOLOGY_SECTIONS } from "../lib/methodology.js";
import { Link } from "./Router.js";

export default function Methodology() {
  return (
    <main className="page-shell">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-amber-400/70">Справка</p>
          <h1 className="mt-2 font-display text-2xl uppercase text-white">Методика</h1>
          <p className="mt-3 font-mono text-[11px] leading-relaxed text-white/40">
            Как считаем показатели аналитики. Без описания сбора данных — только логика разбора
            каталога.
          </p>
          <nav className="mt-6 space-y-1">
            {METHODOLOGY_SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  // Don't use href="#id" — hash router treats it as a new route → home.
                  document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="block w-full truncate text-left font-mono text-[11px] text-white/45 transition hover:text-amber-200"
              >
                {s.title}
              </button>
            ))}
          </nav>
          <Link
            to="/analytics"
            className="mt-8 inline-block font-mono text-[10px] uppercase tracking-[0.15em] text-amber-300/80 hover:text-amber-200"
          >
            → К аналитике
          </Link>
        </aside>

        <div className="space-y-10">
          <header className="border border-white/10 p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-white/40">
              Республика Мордовия · каталог дел
            </p>
            <h2 className="mt-2 font-display text-3xl uppercase text-white sm:text-4xl">
              Как мы анализируем
            </h2>
            <p className="mt-4 max-w-3xl font-mono text-[13px] leading-relaxed text-white/55">
              Ниже — правила, по которым страница «Аналитика» превращает поля карточек дел в сроки,
              доли, тепловые карты и списки. Короткие подсказки «?» на графиках ссылаются на те же
              идеи; здесь они собраны целиком.
            </p>
          </header>

          {METHODOLOGY_SECTIONS.map((section) => (
            <section
              key={section.id}
              id={section.id}
              className="scroll-mt-28 border border-white/10 p-6"
            >
              <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-amber-400/70">
                {section.id}
              </p>
              <h2 className="mt-2 font-display text-xl uppercase text-white">{section.title}</h2>
              <p className="mt-3 max-w-3xl font-mono text-[12px] leading-relaxed text-white/50">
                {section.lead}
              </p>

              <div className="mt-6 space-y-6">
                {section.blocks.map((block) => (
                  <div key={block.heading}>
                    <h3 className="font-display text-sm uppercase text-white/85">{block.heading}</h3>
                    {block.paragraphs.map((p) => (
                      <p
                        key={p.slice(0, 48)}
                        className="mt-2 max-w-3xl font-mono text-[12px] leading-relaxed text-white/55"
                      >
                        {p}
                      </p>
                    ))}
                    {block.bullets?.length ? (
                      <ul className="mt-3 list-disc space-y-1.5 pl-5 font-mono text-[12px] leading-relaxed text-white/55">
                        {block.bullets.map((b) => (
                          <li key={b.slice(0, 64)}>{b}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
