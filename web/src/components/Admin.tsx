// Admin panel — users + early-access waitlist. SMTP later.

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  adminDeleteUser,
  adminListUsers,
  adminListWaitlist,
  type AdminUser,
  type WaitlistEntry,
} from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { navigate } from "./Router.js";
import SegmentTabs, { TabPanel } from "./SegmentTabs.js";

type AdminTab = "waitlist" | "users";

export default function Admin() {
  const { user } = useAuth();
  const [tab, setTab] = useState<AdminTab>("waitlist");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [smtpNote, setSmtpNote] = useState("");
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const refresh = async () => {
    setBusy(true);
    setErr(null);
    try {
      const [u, w] = await Promise.all([adminListUsers(), adminListWaitlist()]);
      setUsers(u);
      setWaitlist(w.entries);
      setSmtpNote(w.note);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ошибка");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const remove = async (id: string, emailAddr: string) => {
    if (!confirm(`Удалить пользователя ${emailAddr}? Все его ключи и доступ исчезнут сразу.`)) return;
    try {
      await adminDeleteUser(id);
      void refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ошибка");
    }
  };

  if (!user || user.role !== "admin") {
    navigate("/cabinet");
    return null;
  }

  return (
    <main className="page-shell">
      <div className="mx-auto max-w-4xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-white/40">Админ-панель</p>
          <h1 className="mt-2 font-display text-3xl text-white md:text-5xl">Управление</h1>
          <p className="mt-2 font-mono text-[12px] text-white/40">
            Заявки на ранний доступ и пользователи. SMTP подключим позже.
          </p>
        </motion.div>

        <div className="mt-6">
          <SegmentTabs
            tabs={[
              { id: "waitlist", label: `Заявки · ${waitlist.length}` },
              { id: "users", label: `Люди · ${users.length}` },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>

        {err ? (
          <p className="mt-4 border border-red-500/30 bg-red-500/10 px-3 py-2 font-mono text-[12px] text-red-300">
            {err}
          </p>
        ) : null}

        <TabPanel always active={tab === "waitlist"} className="mt-6">
          <section className="border border-white/10 p-4 md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/50">
                Заявки с лендинга
              </h2>
              <button
                type="button"
                onClick={() => void refresh()}
                className="border border-white/20 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-white/60"
              >
                Обновить
              </button>
            </div>
            <p className="mt-2 font-mono text-[11px] text-amber-300/70">{smtpNote || "SMTP не подключён"}</p>
            {busy ? (
              <p className="mt-4 font-mono text-sm text-white/40">загрузка…</p>
            ) : waitlist.length === 0 ? (
              <p className="mt-6 font-mono text-sm text-white/40">Пока нет заявок.</p>
            ) : (
              <ul className="mt-4 divide-y divide-white/10">
                {waitlist.map((e) => (
                  <li key={e.id} className="py-4">
                    <p className="font-mono text-sm text-white">{e.email}</p>
                    {e.name ? <p className="mt-1 font-mono text-[12px] text-white/55">{e.name}</p> : null}
                    {e.note ? (
                      <p className="mt-1 font-mono text-[11px] leading-relaxed text-white/40">{e.note}</p>
                    ) : null}
                    <p className="mt-2 font-mono text-[10px] text-white/30">
                      {new Date(e.createdAt).toLocaleString("ru-RU")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </TabPanel>

        <TabPanel always active={tab === "users"} className="mt-6">
          <section className="border border-white/10 p-4 md:p-6">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/50">Пользователи</h2>
            <p className="mt-2 font-mono text-[12px] text-white/45">
              Инвайты — в кабинете. Здесь список аккаунтов.
            </p>
            {busy ? (
              <p className="mt-4 font-mono text-sm text-white/40">загрузка…</p>
            ) : (
              <ul className="mt-4 divide-y divide-white/10">
                {users.map((u) => (
                  <li key={u.id} className="flex items-center justify-between gap-3 py-4">
                    <div className="min-w-0">
                      <p className="font-mono text-sm text-white">
                        {u.email}
                        {u.email === user.email ? <span className="ml-2 text-white/30">(вы)</span> : null}
                      </p>
                      <p className="font-mono text-[11px] text-white/40">
                        {u.role === "admin" ? "админ" : "пользователь"} · ключей {u.keys} ·{" "}
                        {new Date(u.createdAt).toLocaleDateString("ru-RU")}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void remove(u.id, u.email)}
                      disabled={u.email === user.email}
                      className="shrink-0 border border-white/20 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-white/70 disabled:opacity-20"
                    >
                      Удалить
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </TabPanel>

        <div className="mt-10">
          <button
            type="button"
            onClick={() => navigate("/cabinet")}
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40 transition hover:text-white"
          >
            ← Кабинет
          </button>
        </div>
      </div>
    </main>
  );
}
