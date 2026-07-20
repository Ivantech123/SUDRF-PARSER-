// Login page — email + password. On success → cabinet.

import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { login } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { navigate, Link } from "./Router.js";
import AuthShell from "./AuthShell.js";

export default function Login() {
  const { login: setSession } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const user = await login(email, password);
      setSession(user);
      navigate("/cabinet");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell busy={busy} busyLabel="Авторизация…">
      <motion.h1
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="font-display text-3xl tracking-wider text-white"
      >
        Вход
      </motion.h1>
      <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.3em] text-white/40">
        Кабинет A2CHATSKY
      </p>

      <form onSubmit={(e) => void submit(e)} className="mt-8 space-y-5">
        <motion.div
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }}
        >
          <label className="mb-2 block font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
            Эл. почта
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-white/15 bg-black/80 px-4 py-3.5 font-mono text-sm text-white outline-none transition focus:border-amber-400/50"
            placeholder="you@example.com"
            autoComplete="email"
          />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.18 }}
        >
          <label className="mb-2 block font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
            Пароль
          </label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-white/15 bg-black/80 px-4 py-3.5 font-mono text-sm text-white outline-none transition focus:border-amber-400/50"
            placeholder="••••••••"
            autoComplete="current-password"
          />
        </motion.div>

        {err ? (
          <motion.p
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="border border-red-500/30 bg-red-500/10 px-3 py-2 font-mono text-[12px] text-red-300"
          >
            {err}
          </motion.p>
        ) : null}

        <motion.button
          type="submit"
          disabled={busy}
          whileTap={{ scale: 0.98 }}
          className="w-full border border-white bg-white px-4 py-3.5 font-mono text-[12px] uppercase tracking-[0.2em] text-black transition hover:bg-transparent hover:text-white disabled:opacity-40"
        >
          Войти
        </motion.button>
      </form>
      <p className="mt-6 font-mono text-[11px] leading-relaxed text-white/35">
        Нет аккаунта?{" "}
        <Link to="/" className="text-amber-300/80 underline-offset-2 hover:underline">
          Заявка на ранний доступ
        </Link>{" "}
        или ссылка-приглашение.
      </p>
    </AuthShell>
  );
}
