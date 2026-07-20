import { useEffect, useId, useState, type ReactNode } from "react";
import ModalPortal from "./ModalPortal.js";

/** «?» → centered help sheet (mobile-first; no clipped absolute popovers). */
export default function HelpTip({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const titleId = `${id}-title`;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <span className={`inline-flex align-middle ${className}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? id : undefined}
        aria-label={title ? `Справка: ${title}` : "Справка"}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="ml-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/25 font-mono text-[11px] text-white/50 transition active:border-amber-400/60 active:bg-amber-400/10 active:text-amber-200 md:h-5 md:w-5 md:text-[10px] md:hover:border-amber-400/50 md:hover:text-amber-200"
      >
        ?
      </button>

      {open ? (
        <ModalPortal>
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center px-4"
            style={{
              paddingTop: "calc(var(--nav-top) + env(safe-area-inset-top) + 0.5rem)",
              paddingBottom: "calc(var(--nav-bottom) + env(safe-area-inset-bottom) + 0.5rem)",
            }}
            role="presentation"
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/85"
              aria-label="Закрыть справку"
              onClick={() => setOpen(false)}
            />
            <div
              id={id}
              role="dialog"
              aria-modal="true"
              aria-labelledby={title ? titleId : undefined}
              className="relative z-10 flex max-h-full w-full max-w-sm flex-col overflow-hidden rounded-xl border border-amber-400/35 bg-[#0c0c0e] shadow-[0_24px_80px_rgba(0,0,0,0.9)]"
            >
              <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-3.5">
                <div className="min-w-0">
                  <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-amber-400/70">Справка</p>
                  {title ? (
                    <p id={titleId} className="mt-1 font-display text-lg uppercase leading-tight text-white">
                      {title}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="shrink-0 border border-white/20 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-white/60 active:border-white/40 active:text-white"
                >
                  Закрыть
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
                <div className="space-y-3 font-mono text-[12px] leading-relaxed text-white/75 [&_p]:text-white/75 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-4 [&_li]:text-white/70">
                  {children}
                </div>
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}
    </span>
  );
}

export function HelpTitle({
  as: Tag = "h2",
  className,
  children,
  helpTitle,
  help,
}: {
  as?: "h2" | "h3" | "p";
  className?: string;
  children: ReactNode;
  helpTitle: string;
  help: ReactNode;
}) {
  return (
    <Tag className={`${className ?? ""} flex flex-wrap items-center gap-x-1`}>
      <span className="min-w-0">{children}</span>
      <HelpTip title={helpTitle}>{help}</HelpTip>
    </Tag>
  );
}
