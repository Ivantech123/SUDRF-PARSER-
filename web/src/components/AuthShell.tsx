import { type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "./Router.js";

/** Shared chrome for login / register — atmosphere + loading veil. */
export default function AuthShell({
  children,
  busy = false,
  busyLabel = "Загрузка…",
}: {
  children: ReactNode;
  busy?: boolean;
  busyLabel?: string;
}) {
  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-black px-4 py-16 sm:px-6">
      {/* Ambient layers */}
      <div className="pointer-events-none absolute inset-0">
        <motion.div
          className="absolute -left-1/4 top-0 h-[60vh] w-[70vw] rounded-full bg-amber-500/[0.07] blur-[100px]"
          animate={{ x: [0, 40, 0], y: [0, 30, 0], opacity: [0.5, 0.85, 0.5] }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute -right-1/4 bottom-0 h-[50vh] w-[60vw] rounded-full bg-sky-500/[0.06] blur-[90px]"
          animate={{ x: [0, -30, 0], y: [0, -40, 0], opacity: [0.4, 0.75, 0.4] }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut", delay: 1 }}
        />
        <motion.div
          className="absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
          animate={{ backgroundPosition: ["0px 0px", "48px 48px"] }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
        />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-6 text-center"
        >
          <Link to="/" className="font-display text-2xl tracking-wider text-white">
            A2CHATSKY
          </Link>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 28, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="relative overflow-hidden border border-white/15 bg-black/70 p-7 shadow-[0_24px_80px_rgba(0,0,0,0.65)] backdrop-blur-xl sm:p-8"
        >
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/60 to-transparent"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 3, repeat: Infinity }}
          />
          {children}
        </motion.div>
      </div>

      <AnimatePresence>
        {busy ? (
          <motion.div
            key="auth-loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/75 backdrop-blur-sm"
            role="status"
            aria-live="polite"
          >
            <motion.div
              className="h-10 w-10 rounded-full border-2 border-white/15 border-t-amber-400"
              animate={{ rotate: 360 }}
              transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
            />
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 font-mono text-[11px] uppercase tracking-[0.25em] text-white/60"
            >
              {busyLabel}
            </motion.p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </main>
  );
}
