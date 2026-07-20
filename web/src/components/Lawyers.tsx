import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../lib/auth.js";
import {
  listLawyers,
  getLawyerDetail,
  getCaseDetail,
  searchParticipants,
  getParticipantDossier,
  type LawyerCard,
  type StoredCase,
  type ParticipantPerson,
  type ParticipantDossier,
} from "../lib/api.js";
import { navigate } from "./Router.js";
import ProCard from "./ProCard.js";
import RepCard from "./RepCard.js";
import CaseDetail from "./CaseDetail.js";
import RatingTour from "./RatingTour.js";
import LawyerHeatmap from "./LawyerHeatmap.js";
import LawyerFullscreen from "./LawyerFullscreen.js";
import ParticipantDossierModal from "./ParticipantDossier.js";
import ModalPortal from "./ModalPortal.js";

type Tab = "lawyer" | "judge" | "representative";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "judge", label: "Судьи" },
  { id: "lawyer", label: "Юристы" },
  { id: "representative", label: "Представители" },
];

function CardCarousel({ children, resetKey }: { children: ReactNode; resetKey: string }) {
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ left: 0, behavior: "auto" });
  }, [resetKey]);

  return (
    <div>
      <p className="mb-2 text-center font-mono text-[9px] uppercase tracking-[0.2em] text-white/30 md:hidden">
        ← свайп →
      </p>
      <div
        ref={scroller}
        className="card-carousel flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4 [-webkit-overflow-scrolling:touch] md:flex-wrap md:justify-start md:gap-3 md:overflow-visible md:snap-none md:pb-0"
      >
        {children}
      </div>
    </div>
  );
}

export default function Lawyers() {
  const { user } = useAuth();
  const [lawyers, setLawyers] = useState<LawyerCard[]>([]);
  const [reps, setReps] = useState<ParticipantPerson[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [role, setRole] = useState<Tab>("judge");
  const [indexBuilding, setIndexBuilding] = useState(false);
  const [selected, setSelected] = useState<LawyerCard | null>(null);
  const [repDossier, setRepDossier] = useState<ParticipantDossier | null>(null);
  const [lawyerForCase, setLawyerForCase] = useState<LawyerCard | null>(null);
  const [caseDetail, setCaseDetail] = useState<StoredCase | null>(null);
  const [caseLoading, setCaseLoading] = useState(false);
  const [ratingTourOpen, setRatingTourOpen] = useState(false);

  useEffect(() => {
    if (!user) navigate("/login");
  }, [user]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      setLoading(true);
      try {
        if (role === "representative") {
          const data = await searchParticipants({
            q: debouncedQ || undefined,
            role: "representative",
            limit: 60,
            minCases: 1,
          });
          if (cancelled) return;
          setReps(data.people);
          setLawyers([]);
          setTotal(data.total);
          setIndexBuilding(false);
        } else {
          const data = await listLawyers({ q: debouncedQ || undefined, role, limit: 60 });
          if (cancelled) return;
          setLawyers(data.lawyers);
          setReps([]);
          setTotal(data.total);
          const building = data.indexReady === false;
          setIndexBuilding(building);
          if (building) pollTimer = setTimeout(() => void load(), 3000);
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [user, debouncedQ, role]);

  const openLawyer = async (card: LawyerCard) => {
    try {
      setSelected(await getLawyerDetail(card.id));
    } catch {
      setSelected(card);
    }
  };

  const openRep = async (person: ParticipantPerson) => {
    try {
      setRepDossier(
        await getParticipantDossier({
          id: person.id,
          role: "representative",
        }),
      );
    } catch (e) {
      console.error(e);
    }
  };

  const openCase = async (caseId: string) => {
    setCaseLoading(true);
    try {
      const full = await getCaseDetail(caseId);
      setLawyerForCase(selected);
      setSelected(null);
      setRepDossier(null);
      setCaseDetail(full);
    } catch (e) {
      console.error(e);
    } finally {
      setCaseLoading(false);
    }
  };

  const lawyerContext = lawyerForCase?.name;

  return (
    <main className="page-shell">
      <div className="mx-auto max-w-7xl">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-amber-400/80">Рейтинг</p>
          <h1 className="mt-2 font-display text-4xl uppercase tracking-wide text-white sm:text-5xl">
            Юристы, судьи, представители
          </h1>
          <button
            type="button"
            onClick={() => setRatingTourOpen(true)}
            className="mt-3 border border-amber-400/40 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-amber-300/90 hover:bg-amber-400/10"
          >
            ? Как считается рейтинг
          </button>
          <p className="mt-4 max-w-2xl font-mono text-[13px] leading-relaxed text-white/50">
            Карточка открывается на весь экран: разбор рейтинга, карта России с теплом по регионам,
            суды, категории и связанные дела.
          </p>
        </motion.div>

        {role !== "representative" ? (
          <div className="mt-8">
            <LawyerHeatmap role={role === "judge" ? "judge" : "lawyer"} />
          </div>
        ) : null}

        <section className="mt-8 flex flex-col gap-4 border border-white/10 p-4 sm:flex-row sm:items-center">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по ФИО, суду, категории…"
            className="min-w-0 flex-1 border border-white/15 bg-black px-4 py-3 font-mono text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-400/60"
          />
          <div className="flex flex-wrap gap-2">
            {TABS.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRole(r.id)}
                className={`border px-4 py-2 font-mono text-[10px] uppercase tracking-wider transition ${
                  role === r.id
                    ? "border-amber-400 bg-amber-400/10 text-amber-300"
                    : "border-white/15 text-white/50 hover:border-white/40"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </section>

        <p className="mt-6 font-mono text-[11px] uppercase tracking-wider text-white/40">
          {loading
            ? "Загрузка…"
            : indexBuilding
              ? "Индекс карточек строится (1–2 мин)…"
              : `Найдено: ${total}`}
        </p>

        <div className="mt-4 md:mt-6">
          <CardCarousel resetKey={`${role}:${debouncedQ}`}>
            {role === "representative"
              ? reps.map((p, i) => (
                  <div key={p.id} className="card-slide shrink-0 snap-center" style={{ animationDelay: `${Math.min(i * 0.02, 0.3)}s` }}>
                    <RepCard
                      onClick={() => void openRep(p)}
                      dossier={{
                        person: p,
                        rating: Math.min(99, 40 + p.cases * 2 + p.withActs),
                        tier:
                          p.cases >= 20 ? "gold" : p.cases >= 10 ? "silver" : p.cases >= 4 ? "bronze" : "common",
                        roleLabel: "ПРЕДСТАВИТЕЛЬ",
                        stats: {
                          cases: p.cases,
                          courts: p.courts,
                          withActs: p.withActs,
                          enrichedCases: p.enrichedCases,
                          knownOutcomes: 0,
                          wins: 0,
                          losses: 0,
                          neutrals: 0,
                          winRate: null,
                          medianDays: null,
                        },
                        outcomes: {},
                        byCourt: [],
                        byCategory: [],
                        byYear: [],
                        cases: [],
                        caveat: "",
                      }}
                    />
                  </div>
                ))
              : lawyers.map((l, i) => (
                  <motion.div
                    key={l.id}
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: Math.min(i * 0.02, 0.3) }}
                    className="card-slide shrink-0 snap-center"
                  >
                    <ProCard card={l} onClick={() => void openLawyer(l)} />
                  </motion.div>
                ))}
          </CardCarousel>
        </div>

        {!loading && total === 0 && !indexBuilding && (
          <p className="mt-12 text-center font-mono text-sm text-white/40">
            {role === "lawyer"
              ? "Юристов пока мало — нужны полные карточки дел с участниками."
              : role === "representative"
                ? "Представителей мало — дождитесь переразбора карточек дел."
                : "Судьи берутся из поля «судья» в делах."}
          </p>
        )}
      </div>

      <AnimatePresence>
        {selected && !caseDetail && (
          <LawyerFullscreen
            card={selected}
            onClose={() => setSelected(null)}
            onOpenCase={(id) => void openCase(id)}
            caseLoading={caseLoading}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {repDossier && !caseDetail && (
          <ParticipantDossierModal
            dossier={repDossier}
            onClose={() => setRepDossier(null)}
            onOpenCase={(c) => {
              setRepDossier(null);
              setCaseDetail(c);
            }}
          />
        )}
      </AnimatePresence>

      {caseLoading && (
        <ModalPortal>
          <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <p className="border border-sky-400/40 bg-black px-6 py-4 font-mono text-sm text-sky-200">
              Загрузка карточки дела…
            </p>
          </div>
        </ModalPortal>
      )}

      <AnimatePresence>
        {caseDetail && (
          <CaseDetail
            key={caseDetail.id}
            caseData={caseDetail}
            onClose={() => {
              setCaseDetail(null);
              if (lawyerForCase) setSelected(lawyerForCase);
            }}
            backLabel={lawyerContext ? `К ${lawyerContext.split(" ").slice(-2).join(" ")}` : "К карточкам"}
            contextLabel={lawyerContext ? `${lawyerForCase?.roleLabel}: ${lawyerContext}` : undefined}
          />
        )}
      </AnimatePresence>

      <RatingTour open={ratingTourOpen} onClose={() => setRatingTourOpen(false)} />
    </main>
  );
}
