import { useEffect, useMemo, useState } from "react";
import {
  searchParticipants,
  getParticipantDossier,
  type ParticipantPerson,
  type ParticipantRoleFacet,
  type ParticipantDossier,
} from "../lib/api.js";
import { PARTICIPANT_ROLE_OPTIONS } from "../lib/case-filters.js";
import ParticipantDossierModal from "./ParticipantDossier.js";
import ModalPortal from "./ModalPortal.js";

const FAMILY_COLOR: Record<string, string> = {
  representative: "text-amber-300",
  plaintiff: "text-sky-300",
  defendant: "text-rose-300/80",
  third: "text-violet-300/80",
  judge: "text-emerald-300/80",
  other: "text-white/50",
};

export default function Participants() {
  const [q, setQ] = useState("");
  const [role, setRole] = useState("representative");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [people, setPeople] = useState<ParticipantPerson[]>([]);
  const [facets, setFacets] = useState<ParticipantRoleFacet[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dossier, setDossier] = useState<ParticipantDossier | null>(null);
  const [dossierLoading, setDossierLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const data = await searchParticipants({
          q: debouncedQ || undefined,
          role: role === "all" ? undefined : role,
          limit: 60,
          minCases: 1,
        });
        if (!cancelled) {
          setPeople(data.people);
          setFacets(data.facets);
          setTotal(data.total);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [debouncedQ, role]);

  const facetByFamily = useMemo(() => {
    const m = new Map(facets.map((f) => [f.family, f]));
    return m;
  }, [facets]);

  const openDossier = async (person: ParticipantPerson) => {
    setDossierLoading(true);
    try {
      const d = await getParticipantDossier({
        id: person.id,
        role: person.primaryFamily === "other" ? undefined : person.primaryFamily,
      });
      setDossier(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDossierLoading(false);
    }
  };

  return (
    <main className="page-shell">
      <div className="mx-auto max-w-7xl space-y-8">
        <header>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-amber-400/70">Участники</p>
          <h1 className="mt-2 font-display text-4xl uppercase text-white">Поиск по ролям</h1>
          <p className="mt-3 max-w-2xl font-mono text-[12px] leading-relaxed text-white/50">
            Поиск по ролям с карточек дел: истец, ответчик, представитель, адвокат, юрист, третьи лица,
            судьи. Отдельно от раздела «Юристы», где собираются личные карточки рейтинга.
          </p>
        </header>

        <div className="flex flex-wrap gap-2">
          {PARTICIPANT_ROLE_OPTIONS.map((o) => {
            const facet = o.id === "all" ? null : facetByFamily.get(o.id);
            const active = role === o.id;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => setRole(o.id)}
                className={`border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] transition ${
                  active
                    ? "border-amber-400/70 bg-amber-400/10 text-amber-200"
                    : "border-white/15 text-white/50 hover:border-white/40 hover:text-white"
                }`}
              >
                {o.label}
                {facet ? <span className="ml-2 text-white/35">{facet.people}</span> : null}
              </button>
            );
          })}
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ФИО или организация…"
            className="w-full border border-white/15 bg-black px-4 py-3 font-mono text-[13px] text-white outline-none focus:border-white/50 placeholder:text-white/25"
          />
          <p className="flex items-center font-mono text-[11px] text-white/40">
            {loading ? "ищем…" : `найдено ${total}`}
          </p>
        </div>

        {error ? <p className="font-mono text-sm text-red-300">{error}</p> : null}

        <ul className="divide-y divide-white/10 border border-white/10">
          {people.map((p) => (
            <li key={p.id} className="flex flex-wrap items-start justify-between gap-4 px-4 py-3 hover:bg-white/[0.03]">
              <button type="button" onClick={() => void openDossier(p)} className="min-w-0 flex-1 text-left">
                <p className="font-display text-lg text-white">{p.name}</p>
                <p className={`mt-1 font-mono text-[10px] uppercase tracking-[0.15em] ${FAMILY_COLOR[p.primaryFamily] ?? "text-white/40"}`}>
                  {p.roles.slice(0, 4).join(" · ") || p.primaryFamily}
                </p>
                <p className="mt-2 font-mono text-[11px] text-white/45">
                  дел {p.cases} · судов {p.courts} · акты {p.withActs}
                  {p.sampleCaseNumbers.length
                    ? ` · ${p.sampleCaseNumbers.slice(0, 3).join(", ")}`
                    : ""}
                </p>
              </button>
              <button
                type="button"
                onClick={() => void openDossier(p)}
                className="shrink-0 border border-amber-400/50 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-amber-200 hover:bg-amber-400/10"
              >
                Карточка →
              </button>
            </li>
          ))}
        </ul>
        {!loading && !people.length ? (
          <p className="font-mono text-[12px] text-white/40">
            Никого не нашли. Для ПРЕДСТАВИТЕЛЬ нужны обогащённые карточки с блоком участников (cont4).
          </p>
        ) : null}
      </div>

      {dossierLoading && (
        <ModalPortal>
          <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <p className="border border-amber-400/40 bg-black px-6 py-4 font-mono text-sm text-amber-200">
              Собираем карточку…
            </p>
          </div>
        </ModalPortal>
      )}
      {dossier && (
        <ParticipantDossierModal dossier={dossier} onClose={() => setDossier(null)} />
      )}
    </main>
  );
}
