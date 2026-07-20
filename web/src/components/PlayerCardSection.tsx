import { motion } from "framer-motion";
import type { LawyerCard } from "../lib/api.js";
import ProCard from "./ProCard.js";
import { navigate } from "./Router.js";

type PlayerCardState =
  | { status: "found"; card: LawyerCard; isLawyer: boolean; isJudge: boolean }
  | { status: "waiting"; participantRole: string; displayName: string; message: string }
  | { status: "need_profile"; message: string }
  | { status: "none"; message: string };

export default function PlayerCardSection({ data }: { data: PlayerCardState | null }) {
  if (!data) return null;

  if (data.status === "need_profile" || data.status === "none") {
    return (
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-8 border border-amber-400/25 bg-amber-400/5 p-5"
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-400/80">Ваша карточка</p>
        <p className="mt-2 font-mono text-[13px] leading-relaxed text-white/60">{data.message}</p>
        <button
          type="button"
          onClick={() => navigate("/profile")}
          className="mt-4 border border-white/25 px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-white/70 hover:border-white hover:text-white"
        >
          Заполнить профиль →
        </button>
      </motion.section>
    );
  }

  if (data.status === "waiting") {
    const label = data.participantRole === "lawyer" ? "Юрист" : "Судья";
    return (
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-8 border border-sky-400/30 bg-sky-400/5 p-5"
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-sky-400">Карточка {label}</p>
        <p className="mt-2 font-display text-xl text-white">{data.displayName}</p>
        <p className="mt-2 font-mono text-[12px] leading-relaxed text-white/55">{data.message}</p>
        <p className="mt-3 font-mono text-[10px] text-white/35">Парсер обновляет каталог каждую минуту — загляните позже.</p>
      </motion.section>
    );
  }

  const { card } = data;
  const roleLabel =
    card.primaryRole === "lawyer"
      ? "Ваша карточка юриста"
      : card.primaryRole === "judge"
        ? "Ваша карточка судьи"
        : "Ваша игровая карточка";

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-8 overflow-hidden border border-amber-400/35 bg-gradient-to-br from-amber-400/10 via-black to-black p-6"
    >
      <div className="flex flex-col items-center gap-8 lg:flex-row lg:items-start">
        <motion.div
          initial={{ scale: 0.92, rotateY: -8 }}
          animate={{ scale: 1, rotateY: 0 }}
          transition={{ type: "spring", damping: 20, stiffness: 200 }}
        >
          <ProCard card={card} large />
        </motion.div>

        <div className="min-w-0 flex-1 text-center lg:text-left">
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-amber-400">{roleLabel}</p>
          <h2 className="mt-2 font-display text-3xl text-white">{card.name}</h2>
          <p className="mt-1 font-mono text-[11px] text-white/45">
            {card.roleLabel} · рейтинг {card.rating} · {card.mainCourt}
          </p>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Дела", value: card.stats.cases },
              { label: "Суды", value: card.stats.courts },
              { label: "Документы", value: card.stats.documents },
              { label: "Категории", value: card.stats.categories },
            ].map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.05 }}
                className="border border-white/10 bg-black/40 px-3 py-3"
              >
                <p className="font-mono text-[9px] uppercase tracking-wider text-white/35">{s.label}</p>
                <p className="mt-1 font-display text-2xl text-white">{s.value}</p>
              </motion.div>
            ))}
          </div>

          {card.recentCases.length > 0 && (
            <div className="mt-6">
              <p className="font-mono text-[10px] uppercase tracking-wider text-white/40">Последние дела</p>
              <ul className="mt-2 space-y-1">
                {card.recentCases.slice(0, 3).map((c) => (
                  <li key={c.id} className="truncate font-mono text-[11px] text-white/55">
                    {c.caseNumber} · {c.courtName}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-6 flex flex-wrap justify-center gap-3 lg:justify-start">
            <button
              type="button"
              onClick={() => navigate("/lawyers")}
              className="border border-amber-400/60 px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-amber-300 hover:bg-amber-400/10"
            >
              Все карточки →
            </button>
            <button
              type="button"
              onClick={() => navigate("/profile")}
              className="border border-white/20 px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-white/55 hover:text-white"
            >
              Профиль
            </button>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
