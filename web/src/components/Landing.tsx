// A2CHATSKY landing — measure → catalog → early access.

import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import TiltText from "./TiltText.js";
import { Link, navigate } from "./Router.js";
import { useAuth } from "../lib/auth.js";
import { WavePath } from "./ui/wave-path.js";
import { cn } from "../lib/utils.js";
import { submitWaitlist } from "../lib/api.js";
import { PrivacyConsentPanel, PRIVACY_VERSION } from "./PrivacyPolicy.js";

const PAGES = [
  {
    open: "/cases" as const,
    soon: "#/coming-soon?from=cases",
    label: "01",
    title: "Дела",
    desc: "Поиск по номеру, УИД, участнику и судье. Карточка дела: стороны, ход, акты.",
    accent: false,
  },
  {
    open: "/lawyers" as const,
    soon: "#/coming-soon?from=lawyers",
    label: "02",
    title: "Юристы и судьи",
    desc: "FIFA-карточки с индексом, сроками и практикой. Свайп по списку, досье на весь экран.",
    accent: true,
  },
  {
    open: "/analytics" as const,
    soon: "#/coming-soon?from=analytics",
    label: "03",
    title: "Сводка",
    desc: "Исходы, сезонность, корпус судей — с методикой и подсказками.",
    accent: false,
  },
] as const;

export default function Landing() {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!agreed) {
      setPrivacyOpen(true);
      setErr("Нужно согласие с политикой обработки данных");
      return;
    }
    setBusy(true);
    try {
      await submitWaitlist({ email, name, note, consent: true, privacyVersion: PRIVACY_VERSION });
      setDone(true);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Не удалось отправить");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative">
      {/* ── Hero: first brand, second line ───────────────────────────── */}
      <section className="relative h-[100dvh] w-full overflow-hidden bg-black pb-[env(safe-area-inset-bottom)]">
        <img
          src="/landing-hero.png"
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/55 to-black" />
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="mb-5 font-mono text-[11px] uppercase tracking-[0.4em] text-white/45"
          >
            ГАС «Правосудие» · измеряем практику
          </motion.p>
          <TiltText className="will-change-transform">
            <h1 className="font-display text-[12vw] leading-[0.9] tracking-tight text-white sm:text-[10vw] md:text-[120px]">
              A2CHATSKY
            </h1>
          </TiltText>
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.7 }}
            className="mt-3 font-display text-[5.5vw] uppercase leading-none tracking-wide text-white/35 sm:text-[3.5vw] md:text-[42px]"
          >
            каталог · рейтинг · сводка
          </motion.p>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.45, duration: 0.8 }}
            className="mt-8 max-w-md font-mono text-sm leading-relaxed text-white/55"
          >
            Судебные дела в браузере: поиск, карточки участников и цифры — чтобы видеть
            практику, а не только отдельные акты.
          </motion.p>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.75, duration: 0.8 }}
            className="mt-10 mb-[4.5rem] flex flex-wrap items-center justify-center gap-3 sm:mb-0"
          >
            <a
              href="#early"
              className="border border-amber-400/60 bg-amber-400/10 px-8 py-3 font-mono text-[12px] uppercase tracking-[0.2em] text-amber-200 transition hover:bg-amber-400/20"
            >
              Оставить заявку
            </a>
            <Link
              to={user ? "/cases" : "/login"}
              className="border border-white/40 px-8 py-3 font-mono text-[12px] uppercase tracking-[0.2em] text-white transition hover:bg-white hover:text-black"
            >
              {user ? "Открыть дела" : "Войти"}
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ── Wave + quote (one composition) ───────────────────────────── */}
      <section className="relative flex min-h-[70vh] flex-col items-center justify-center overflow-hidden bg-black px-6 py-24 md:min-h-[80vh] md:py-32">
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute -top-10 left-1/2 size-full -translate-x-1/2 rounded-full",
            "bg-[radial-gradient(ellipse_at_center,rgba(251,191,36,0.1),transparent_50%)]",
            "blur-[30px]",
          )}
        />
        <div className="relative z-[1] flex w-[70vw] max-w-5xl flex-col items-end">
          <p className="mb-3 w-full text-right font-mono text-[10px] uppercase tracking-[0.28em] text-amber-400/70">
            Д. И. Менделеев · метрология
          </p>
          <blockquote className="mb-8 w-full max-w-3xl self-end text-right font-display text-xl uppercase leading-snug text-white md:mb-10 md:text-3xl">
            «Наука начинается там, где начинают измерять».
          </blockquote>

          <WavePath className="mb-8 text-amber-300/90 md:mb-10" />

          <p className="w-full max-w-2xl self-end text-right font-mono text-[12px] leading-relaxed text-white/45 md:text-[13px]">
            Линия реагирует на курсор и палец — как измерение на практике.
            A2CHATSKY считает сроки, исходы и участников, чтобы юрист опирался
            на цифры, а не на ощущение.
          </p>
        </div>
      </section>

      {/* ── Sections ─────────────────────────────────────────────────── */}
      <section id="pages" className="relative bg-black py-24 md:py-32">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="font-display text-3xl uppercase text-white md:text-5xl">Что внутри</h2>
          <p className="mt-3 max-w-xl font-mono text-[13px] text-white/45">
            Три опоры сервиса. Вход по приглашению или заявке на ранний доступ.
          </p>
          <div className="mt-12 space-y-px bg-white/10">
            {PAGES.map((p, i) => {
              const className =
                "group grid grid-cols-1 gap-4 p-6 transition hover:bg-white/[0.02] sm:grid-cols-12 sm:gap-6 sm:p-8";
              const body = (
                <>
                  <div className="sm:col-span-2">
                    <span
                      className={`font-mono text-[12px] tracking-[0.2em] ${
                        p.accent ? "text-amber-400/80" : "text-white/30"
                      }`}
                    >
                      {p.label}
                    </span>
                  </div>
                  <div className="sm:col-span-10">
                    <h3 className="font-display text-2xl uppercase text-white md:text-3xl">
                      {p.title}
                      <span className="ml-3 font-mono text-[11px] text-white/25 group-hover:text-white/50">
                        →
                      </span>
                    </h3>
                    <p className="mt-2 max-w-2xl font-mono text-[13px] leading-relaxed text-white/50">
                      {p.desc}
                    </p>
                  </div>
                </>
              );
              return (
                <motion.div
                  key={p.open}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-40px" }}
                  transition={{ duration: 0.45, delay: i * 0.05 }}
                  className="bg-black"
                >
                  {user ? (
                    <Link to={p.open} className={className}>
                      {body}
                    </Link>
                  ) : (
                    <a href={p.soon} className={className}>
                      {body}
                    </a>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Early access ─────────────────────────────────────────────── */}
      <section id="early" className="relative border-t border-white/10 bg-black py-24 md:py-32">
        <div className="mx-auto max-w-xl px-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-amber-400/70">
            Ранний доступ
          </p>
          <h2 className="mt-2 font-display text-3xl uppercase text-white md:text-5xl">
            Оставить заявку
          </h2>
          <p className="mt-3 font-mono text-[13px] leading-relaxed text-white/45">
            Открытой регистрации нет. Оставьте email — пришлём приглашение, когда откроем доступ.
          </p>

          {done ? (
            <div className="mt-10 border border-emerald-400/40 bg-emerald-400/5 p-6">
              <p className="font-mono text-sm text-emerald-300">Заявка принята.</p>
              <p className="mt-2 font-mono text-[12px] text-white/45">
                Мы свяжемся на указанный адрес. Уже есть инвайт?{" "}
                <Link to="/login" className="text-white/70 underline-offset-2 hover:underline">
                  Войти
                </Link>
              </p>
            </div>
          ) : (
            <form onSubmit={(e) => void onSubmit(e)} className="mt-10 space-y-3">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setPrivacyOpen(true)}
                placeholder="Email *"
                autoComplete="email"
                className="w-full border border-white/20 bg-black px-4 py-3.5 font-mono text-[13px] text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
              />
              <PrivacyConsentPanel
                open={privacyOpen}
                agreed={agreed}
                onAgree={setAgreed}
                onOpenFull={() => navigate("/privacy")}
              />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Имя / организация"
                className="w-full border border-white/20 bg-black px-4 py-3.5 font-mono text-[13px] text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
              />
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Зачем нужен доступ (необязательно)"
                rows={3}
                className="w-full resize-none border border-white/20 bg-black px-4 py-3.5 font-mono text-[13px] text-white outline-none placeholder:text-white/30 focus:border-amber-400/50"
              />
              {err ? <p className="font-mono text-[12px] text-red-400">{err}</p> : null}
              <button
                type="submit"
                disabled={busy || !agreed}
                className="w-full border border-white bg-white px-6 py-3.5 font-mono text-[11px] uppercase tracking-[0.2em] text-black transition hover:bg-transparent hover:text-white disabled:opacity-40"
              >
                {busy ? "Отправка…" : "Отправить заявку"}
              </button>
            </form>
          )}

          {user ? (
            <p className="mt-6 text-center font-mono text-[12px] text-white/40">
              Вы уже вошли —{" "}
              <Link to="/cases" className="text-amber-300/80 underline-offset-2 hover:underline">
                к делам
              </Link>
            </p>
          ) : (
            <p className="mt-6 text-center font-mono text-[12px] text-white/35">
              Есть приглашение?{" "}
              <Link to="/login" className="text-white/60 underline-offset-2 hover:underline">
                Войти
              </Link>
            </p>
          )}
        </div>
      </section>

      <footer className="border-t border-white/10 bg-black py-10">
        <div className="mx-auto max-w-7xl px-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-white/30">
            A2CHATSKY · измеряем судебную практику
          </p>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-2 font-mono text-[11px] text-white/25">
            <span>© {new Date().getFullYear()} A2CHATSKY</span>
            <Link to="/privacy" className="hover:text-white/50">
              Политика данных
            </Link>
          </p>
        </div>
      </footer>
    </main>
  );
}
