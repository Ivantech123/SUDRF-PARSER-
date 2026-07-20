// Closed product teaser — guests land here from «Что внутри» instead of login.

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "./Router.js";

const SECTIONS: Record<string, { label: string; title: string; line: string }> = {
  cases: {
    label: "01",
    title: "Дела",
    line: "Поиск, карточки и ход дел — раздел откроется для приглашённых.",
  },
  lawyers: {
    label: "02",
    title: "Юристы и судьи",
    line: "Рейтинг и досье участников — готовим к раннему доступу.",
  },
  analytics: {
    label: "03",
    title: "Сводка",
    line: "Исходы, сроки и корпус — скоро в кабинете.",
  },
  participants: {
    label: "04",
    title: "Участники",
    line: "Стороны и роли по делам — раздел на подходе.",
  },
};

function sectionFromHash(): string {
  const raw = window.location.hash.replace(/^#/, "");
  const q = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : "";
  return new URLSearchParams(q).get("from") ?? "";
}

export default function ComingSoon() {
  const [key, setKey] = useState(sectionFromHash);
  useEffect(() => {
    const onHash = () => setKey(sectionFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const section = SECTIONS[key];

  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-black px-6 pb-[env(safe-area-inset-bottom)] pt-20">
      <img
        src="/landing-hero.png"
        alt=""
        className="absolute inset-0 h-full w-full object-cover opacity-70"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/85 via-black/70 to-black" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.1]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />

      <div className="relative z-10 w-full max-w-lg text-center">
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
          className="font-mono text-[11px] uppercase tracking-[0.4em] text-amber-400/70"
        >
          {section ? `${section.label} · скоро` : "Скоро"}
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.6 }}
          className="mt-4 font-display text-5xl uppercase tracking-tight text-white md:text-6xl"
        >
          {section?.title ?? "Раздел закрыт"}
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.22, duration: 0.65 }}
          className="mx-auto mt-5 max-w-md font-mono text-[13px] leading-relaxed text-white/50"
        >
          {section?.line ??
            "Сервис открывается по приглашению. Оставьте заявку или войдите, если уже есть доступ."}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.55 }}
          className="mt-10 flex flex-wrap items-center justify-center gap-3"
        >
          <a
            href="#early"
            className="border border-amber-400/60 bg-amber-400/10 px-8 py-3.5 font-mono text-[12px] uppercase tracking-[0.2em] text-amber-200 transition hover:bg-amber-400/20"
          >
            Оставить заявку
          </a>
          <Link
            to="/login"
            className="border border-white/40 px-8 py-3.5 font-mono text-[12px] uppercase tracking-[0.2em] text-white transition hover:bg-white hover:text-black"
          >
            Войти
          </Link>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.55, duration: 0.5 }}
          className="mt-10"
        >
          <Link
            to="/"
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/35 transition hover:text-white/60"
          >
            ← На главную
          </Link>
        </motion.p>
      </div>
    </main>
  );
}
