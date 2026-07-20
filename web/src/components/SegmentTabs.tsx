import type { ReactNode } from "react";

export type SegmentTab<T extends string> = {
  id: T;
  label: string;
};

/** Horizontal category tabs — primary mobile IA pattern. */
export default function SegmentTabs<T extends string>({
  tabs,
  value,
  onChange,
  className = "",
  sticky = false,
}: {
  tabs: ReadonlyArray<SegmentTab<T>>;
  value: T;
  onChange: (id: T) => void;
  className?: string;
  sticky?: boolean;
}) {
  return (
    <nav
      className={`tab-scroll ${
        sticky
          ? "sticky top-[calc(var(--nav-top)+var(--safe-top))] z-20 -mx-4 border-b border-white/10 bg-black/95 px-4 py-2.5 backdrop-blur-sm"
          : ""
      } ${className}`}
      aria-label="Разделы"
      role="tablist"
    >
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={`shrink-0 border px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.12em] transition ${
              active
                ? "border-amber-400/70 bg-amber-400/10 text-amber-200"
                : "border-white/15 text-white/45 active:border-white/35 active:text-white/80"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * Tab content panel.
 * - default: inactive hidden on phone, all panels visible from md+
 * - always: inactive always hidden (true category tabs)
 */
export function TabPanel({
  active,
  children,
  className = "",
  always = false,
}: {
  active: boolean;
  children: ReactNode;
  className?: string;
  always?: boolean;
}) {
  const visibility = active ? "block" : always ? "hidden" : "hidden md:block";
  return (
    <div role="tabpanel" className={`${visibility} ${className}`}>
      {children}
    </div>
  );
}
