// Top nav: grouped dropdowns on desktop; slim brand bar on phones (tabs → BottomNav).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, type Route, useRoute } from "./Router.js";
import { useAuth } from "../lib/auth.js";

function NavGroup({
  label,
  accent,
  children,
}: {
  label: string;
  accent?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 transition ${
          accent
            ? "text-amber-400/80 hover:text-amber-300"
            : "text-white/60 hover:text-white"
        } ${open ? (accent ? "text-amber-300" : "text-white") : ""}`}
      >
        {label}
        <span className={`text-[9px] opacity-60 transition ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-50 mt-3 min-w-[12rem] border border-white/15 bg-black/95 py-2 shadow-[0_16px_48px_rgba(0,0,0,0.7)] backdrop-blur-md">
          <div className="flex flex-col" onClick={() => setOpen(false)}>
            {children}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Item({
  to,
  children,
  hint,
}: {
  to: Route;
  children: ReactNode;
  hint?: string;
}) {
  const route = useRoute();
  const active = route === to;
  return (
    <Link
      to={to}
      className={`block px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.12em] transition ${
        active ? "bg-amber-400/10 text-amber-200" : "text-white/70 hover:bg-white/5 hover:text-white"
      }`}
    >
      <span className="block">{children}</span>
      {hint ? <span className="mt-0.5 block normal-case tracking-normal text-[10px] text-white/35">{hint}</span> : null}
    </Link>
  );
}

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const { user, logout } = useAuth();
  const route = useRoute();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Auth pages: no top chrome
  if (route === "/login" || route === "/register") return null;

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled ? "border-b border-white/10 bg-black/70 backdrop-blur-md" : "bg-transparent"
      }`}
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <nav className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 md:h-16 md:px-6">
        <Link to="/" className="font-display text-lg tracking-wider text-white md:text-xl">
          A2CHATSKY
        </Link>

        {/* Guests: only Login. Authed: full desktop groups + mobile profile. */}
        {!user ? (
          <Link
            to="/login"
            className="border border-white/25 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white transition hover:bg-white hover:text-black md:text-[12px]"
          >
            Войти
          </Link>
        ) : (
          <>
            <div className="hidden items-center gap-7 text-[12px] uppercase tracking-[0.15em] md:flex">
              <NavGroup label="Каталог">
                <Item to="/cases" hint="Поиск и карточки дел">Дела</Item>
                <Item to="/participants" hint="Роли со сторон дела">Участники</Item>
                <Item to="/lawyers" hint="Рейтинг и карточки">Юристы</Item>
              </NavGroup>

              <NavGroup label="Аналитика" accent>
                <Item to="/analytics" hint="Сводка и карты">Сводка</Item>
                <Item to="/methodology" hint="Как считаем показатели">Методика</Item>
              </NavGroup>

              <NavGroup label="Сервис">
                <Item to="/api-docs" hint="Программный доступ">Документация</Item>
                <Item to="/profile" hint="Личные данные">Профиль</Item>
                <Item to="/cabinet" hint="Ключи и подключения">Кабинет</Item>
              </NavGroup>

              <button
                type="button"
                onClick={() => void logout()}
                className="text-white/60 transition hover:text-white"
              >
                Выйти
              </button>
            </div>

            <div className="md:hidden">
              <Link
                to="/profile"
                className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/55"
              >
                {user.profile?.firstName || "Профиль"}
              </Link>
            </div>
          </>
        )}
      </nav>
    </header>
  );
}
