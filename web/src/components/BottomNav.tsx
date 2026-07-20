// Mobile bottom tab bar — primary navigation on phones.

import { useEffect, useState } from "react";
import { Link, type Route, useRoute, navigate } from "./Router.js";
import { useAuth } from "../lib/auth.js";

type Tab = {
  to: Route;
  label: string;
  icon: string;
};

const TABS: Tab[] = [
  { to: "/cases", label: "Дела", icon: "bi-folder2-open" },
  { to: "/participants", label: "Люди", icon: "bi-people" },
  { to: "/lawyers", label: "Юристы", icon: "bi-person-badge" },
  { to: "/analytics", label: "Сводка", icon: "bi-graph-up" },
];

const MORE_ROUTES: Route[] = ["/methodology", "/api-docs", "/profile", "/cabinet", "/admin"];

export default function BottomNav() {
  const route = useRoute();
  const { user, logout } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    setMoreOpen(false);
  }, [route]);

  // Guests see only top «Войти» — no bottom chrome on the marketing site.
  if (
    !user ||
    route === "/login" ||
    route === "/register" ||
    route === "/" ||
    route === "/coming-soon" ||
    route === "/privacy"
  )
    return null;

  const moreActive = MORE_ROUTES.includes(route) || moreOpen;

  return (
    <>
      {moreOpen ? (
        <div className="fixed inset-0 z-[90] md:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-black/80"
            aria-label="Закрыть"
            onClick={() => setMoreOpen(false)}
          />
          {/* Solid sheet — never translucent over cards */}
          <div
            className="absolute inset-x-0 bottom-0 border-t border-white/20 px-4 pt-3 shadow-[0_-20px_60px_rgba(0,0,0,0.9)]"
            style={{
              background: "#0a0a0a",
              paddingBottom: "calc(4.75rem + env(safe-area-inset-bottom))",
            }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/25" />
            <p className="mb-3 font-mono text-[9px] uppercase tracking-[0.2em] text-white/40">Ещё</p>
            <div className="grid grid-cols-2 gap-2">
              <MoreLink to="/methodology" onClick={() => setMoreOpen(false)}>Методика</MoreLink>
              <MoreLink to="/api-docs" onClick={() => setMoreOpen(false)}>API</MoreLink>
              {user ? (
                <>
                  <MoreLink to="/profile" onClick={() => setMoreOpen(false)}>Профиль</MoreLink>
                  <MoreLink to="/cabinet" onClick={() => setMoreOpen(false)}>Кабинет</MoreLink>
                  {user.role === "admin" ? (
                    <MoreLink to="/admin" onClick={() => setMoreOpen(false)}>Админ</MoreLink>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setMoreOpen(false);
                      void logout();
                    }}
                    className="border border-white/20 bg-[#141414] px-3 py-3.5 text-left font-mono text-[11px] uppercase tracking-[0.12em] text-white/70"
                  >
                    Выйти
                  </button>
                </>
              ) : (
                <MoreLink to="/login" onClick={() => setMoreOpen(false)}>Войти</MoreLink>
              )}
              <MoreLink to="/" onClick={() => setMoreOpen(false)}>На главную</MoreLink>
            </div>
          </div>
        </div>
      ) : null}

      <nav
        className="fixed inset-x-0 bottom-0 z-[80] border-t border-white/15 md:hidden"
        style={{
          background: "#050505",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
        aria-label="Основная навигация"
      >
        <div className="mx-auto grid h-[3.75rem] max-w-lg grid-cols-5">
          {TABS.map((tab) => {
            const active = route === tab.to;
            return (
              <Link
                key={tab.to}
                to={tab.to}
                className={`flex flex-col items-center justify-center gap-0.5 font-mono text-[9px] uppercase tracking-[0.08em] transition ${
                  active ? "text-amber-300" : "text-white/45 active:text-white/80"
                }`}
              >
                <i className={`bi ${tab.icon} text-[1.15rem] leading-none`} aria-hidden />
                <span>{tab.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className={`flex flex-col items-center justify-center gap-0.5 font-mono text-[9px] uppercase tracking-[0.08em] transition ${
              moreActive ? "text-amber-300" : "text-white/45 active:text-white/80"
            }`}
          >
            <i className="bi bi-three-dots text-[1.15rem] leading-none" aria-hidden />
            <span>Ещё</span>
          </button>
        </div>
      </nav>
    </>
  );
}

function MoreLink({
  to,
  onClick,
  children,
}: {
  to: Route;
  onClick: () => void;
  children: string;
}) {
  return (
    <a
      href={`#${to}`}
      onClick={(e) => {
        e.preventDefault();
        onClick();
        navigate(to);
      }}
      className="border border-white/20 bg-[#141414] px-3 py-3.5 font-mono text-[11px] uppercase tracking-[0.12em] text-white active:bg-[#1e1e1e]"
    >
      {children}
    </a>
  );
}
