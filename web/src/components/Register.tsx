import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { register as apiRegister } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { navigate, useRoute, Link } from "./Router.js";
import AuthShell from "./AuthShell.js";

function inviteTokenFromHash(): string {
  const hash = window.location.hash.replace(/^#/, "");
  const q = hash.includes("?") ? hash.split("?")[1] : "";
  return new URLSearchParams(q).get("invite") ?? "";
}

export default function Register() {
  const { user, login: setSession } = useAuth();
  const route = useRoute();
  const token = useMemo(() => inviteTokenFromHash(), [route]);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [patronymic, setPatronymic] = useState("");
  const [city, setCity] = useState("");
  const [company, setCompany] = useState("");
  const [participantRole, setParticipantRole] = useState<"lawyer" | "judge" | "other">("other");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (user) navigate("/profile");
  }, [user]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) {
      setErr("Нужна ссылка-приглашение от существующего пользователя");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const u = await apiRegister({
        token,
        email,
        password,
        firstName,
        lastName,
        patronymic: patronymic || undefined,
        city: city || undefined,
        company: company || undefined,
        participantRole,
      });
      setSession(u);
      navigate("/profile");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "registration failed");
    } finally {
      setBusy(false);
    }
  };

  const fieldClass =
    "w-full border border-white/15 bg-black/80 px-4 py-3.5 font-mono text-[13px] text-white outline-none transition focus:border-amber-400/50 placeholder:text-white/30";

  return (
    <AuthShell busy={busy} busyLabel="Создание профиля…">
      <h1 className="font-display text-3xl tracking-wider text-white">Регистрация</h1>
      <p className="mt-2 font-mono text-[11px] text-white/45">
        {token ? "Приглашение принято — заполните профиль" : "Откройте ссылку-приглашение из кабинета"}
      </p>

      <div className="mt-6 flex gap-2">
        {["ФИО", "Аккаунт"].map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => setStep(i)}
            className={`flex-1 border py-2.5 text-center font-mono text-[9px] uppercase tracking-wider transition ${
              step === i
                ? "border-amber-400/60 bg-amber-400/10 text-amber-200"
                : "border-white/15 text-white/35"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-4">
        <AnimatePresence mode="wait">
          {step === 0 ? (
            <motion.div
              key="step-0"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.25 }}
              className="space-y-3"
            >
              <input required placeholder="Имя" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={fieldClass} />
              <input required placeholder="Фамилия" value={lastName} onChange={(e) => setLastName(e.target.value)} className={fieldClass} />
              <input placeholder="Отчество" value={patronymic} onChange={(e) => setPatronymic(e.target.value)} className={fieldClass} />
              <input placeholder="Город" value={city} onChange={(e) => setCity(e.target.value)} className={fieldClass} />
              <input placeholder="Компания / коллегия" value={company} onChange={(e) => setCompany(e.target.value)} className={fieldClass} />
              <div>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-white/40">Роль</p>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["lawyer", "Юрист"],
                      ["judge", "Судья"],
                      ["other", "Пользователь"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setParticipantRole(value)}
                      className={`border px-3 py-2 font-mono text-[10px] uppercase tracking-wider transition ${
                        participantRole === value
                          ? "border-amber-400 text-amber-300"
                          : "border-white/15 text-white/45"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="w-full border border-white bg-white px-4 py-3.5 font-mono text-[11px] uppercase tracking-[0.15em] text-black transition hover:bg-transparent hover:text-white"
              >
                Далее →
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="step-1"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.25 }}
              className="space-y-3"
            >
              <input required type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className={fieldClass} autoComplete="email" />
              <input required type="password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} className={fieldClass} autoComplete="new-password" />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep(0)}
                  className="flex-1 border border-white/25 px-4 py-3.5 font-mono text-[11px] uppercase tracking-[0.12em] text-white/70"
                >
                  ← Назад
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="flex-1 border border-white bg-white px-4 py-3.5 font-mono text-[11px] uppercase tracking-[0.12em] text-black disabled:opacity-40"
                >
                  Создать
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {err ? (
          <p className="border border-red-500/30 bg-red-500/10 px-3 py-2 font-mono text-[12px] text-red-300">{err}</p>
        ) : null}
      </form>

      <Link to="/login" className="mt-6 inline-block font-mono text-[11px] text-white/40 transition hover:text-white">
        Уже есть аккаунт →
      </Link>
    </AuthShell>
  );
}
