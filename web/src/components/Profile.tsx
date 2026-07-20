import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../lib/auth.js";
import { updateProfile } from "../lib/api.js";
import {
  formatParticipantRole,
  participantRoleChangeInfo,
  type ParticipantRole,
} from "../lib/participant-role.js";
import { navigate } from "./Router.js";

export default function Profile() {
  const { user, login: setSession } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [patronymic, setPatronymic] = useState("");
  const [city, setCity] = useState("");
  const [company, setCompany] = useState("");
  const [bio, setBio] = useState("");
  const [participantRole, setParticipantRole] = useState<ParticipantRole>("other");
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      navigate("/login");
      return;
    }
    setFirstName(user.profile?.firstName ?? "");
    setLastName(user.profile?.lastName ?? "");
    setPatronymic(user.profile?.patronymic ?? "");
    setCity(user.profile?.city ?? "");
    setCompany(user.profile?.company ?? "");
    setBio(user.profile?.bio ?? "");
    setParticipantRole(user.profile?.participantRole ?? "other");
  }, [user]);

  const roleChange = useMemo(() => participantRoleChangeInfo(user?.profile), [user?.profile]);

  if (!user) return null;

  const displayName = [firstName, patronymic, lastName].filter(Boolean).join(" ") || user.email;
  const savedRole = user.profile?.participantRole ?? "other";
  const roleLocked = !roleChange.canChange && participantRole !== savedRole;

  const save = async () => {
    setErr(null);
    try {
      const u = await updateProfile({ firstName, lastName, patronymic, city, company, bio, participantRole });
      setSession(u);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось сохранить");
    }
  };

  return (
    <main className="page-shell overflow-x-clip">
      <div className="relative mx-auto max-w-3xl pb-24 md:pb-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/40">Профиль</p>
        <h1 className="mt-1 font-display text-2xl text-white md:text-4xl">{displayName}</h1>
        <p className="mt-1 font-mono text-[12px] text-white/45">
          {user.email}
          <span className="text-white/25"> · </span>
          {user.role === "admin" ? "Админ" : "Пользователь"}
          <span className="text-white/25"> · </span>
          {formatParticipantRole(participantRole)}
        </p>

        <section className="mt-8 border border-white/10 p-4 md:p-6">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">Данные</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Имя" className="field" />
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Фамилия" className="field" />
            <input value={patronymic} onChange={(e) => setPatronymic(e.target.value)} placeholder="Отчество" className="field" />
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Город" className="field" />
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Компания"
              className="field md:col-span-2"
            />
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="О себе"
              rows={3}
              className="field resize-none md:col-span-2"
            />

            <div className="md:col-span-2">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-white/40">
                Роль для игровой карточки
              </p>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["lawyer", "Юрист"],
                    ["judge", "Судья"],
                    ["other", "Пользователь"],
                  ] as const
                ).map(([value, label]) => {
                  const isCurrent = savedRole === value;
                  const disabled = !roleChange.canChange && !isCurrent;
                  return (
                    <button
                      key={value}
                      type="button"
                      disabled={disabled}
                      onClick={() => setParticipantRole(value)}
                      className={`border px-3 py-2.5 font-mono text-[10px] uppercase tracking-wider disabled:cursor-not-allowed disabled:opacity-35 ${
                        participantRole === value
                          ? "border-amber-400 text-amber-300"
                          : "border-white/15 text-white/45"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 font-mono text-[10px] leading-relaxed text-white/35">
                Юрист или судья — в кабинете появится карточка со статистикой. Пользователь — без карточки.
              </p>
              {!roleChange.canChange && roleChange.nextChangeAt ? (
                <p className="mt-2 font-mono text-[10px] text-amber-400/90">
                  Сменить роль можно с {new Date(roleChange.nextChangeAt).toLocaleDateString("ru-RU")} (раз в месяц).
                </p>
              ) : null}
            </div>
          </div>

          {/* Desktop actions */}
          <div className="mt-4 hidden flex-wrap gap-3 md:flex">
            <button type="button" onClick={() => void save()} className="btn-primary">
              Сохранить
            </button>
            <button type="button" onClick={() => navigate("/cabinet")} className="btn-ghost">
              MCP-кабинет →
            </button>
            {saved ? <span className="self-center font-mono text-[11px] text-emerald-400">Сохранено</span> : null}
            {err ? <span className="self-center font-mono text-[11px] text-red-400">{err}</span> : null}
            {roleLocked ? (
              <span className="self-center font-mono text-[11px] text-amber-400/80">
                Роль заблокирована до{" "}
                {roleChange.nextChangeAt
                  ? new Date(roleChange.nextChangeAt).toLocaleDateString("ru-RU")
                  : "—"}
              </span>
            ) : null}
          </div>
        </section>

        <button
          type="button"
          onClick={() => navigate("/cabinet")}
          className="mt-4 font-mono text-[11px] uppercase tracking-[0.15em] text-white/40 md:hidden"
        >
          MCP-кабинет →
        </button>
      </div>

      {/* Sticky save — mobile */}
      <div
        className="fixed inset-x-0 z-[70] border-t border-white/15 bg-[#0a0a0a] px-4 py-3 md:hidden"
        style={{ bottom: "calc(var(--nav-bottom) + env(safe-area-inset-bottom))" }}
      >
        <button type="button" onClick={() => void save()} className="btn-primary w-full py-3.5">
          Сохранить
        </button>
        {saved ? <p className="mt-2 text-center font-mono text-[11px] text-emerald-400">Сохранено</p> : null}
        {err ? <p className="mt-2 text-center font-mono text-[11px] text-red-400">{err}</p> : null}
      </div>

      <style>{`
        .field { width:100%; border:1px solid rgba(255,255,255,0.15); background:#000; padding:12px 14px; font-family:ui-monospace,monospace; font-size:13px; color:#fff; outline:none; }
        .field:focus { border-color: rgba(255,255,255,0.45); }
        .btn-primary { border:1px solid #fff; padding:10px 16px; font-family:ui-monospace,monospace; font-size:10px; text-transform:uppercase; letter-spacing:0.12em; color:#fff; }
        .btn-primary:hover { background:#fff; color:#000; }
        .btn-ghost { border:1px solid rgba(255,255,255,0.2); padding:10px 16px; font-family:ui-monospace,monospace; font-size:10px; text-transform:uppercase; color:rgba(255,255,255,0.55); }
      `}</style>
    </main>
  );
}
