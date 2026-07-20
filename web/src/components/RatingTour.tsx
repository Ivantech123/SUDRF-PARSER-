import { motion, AnimatePresence } from "framer-motion";
import { RATING_TOUR_STEPS } from "../lib/rating-info.js";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function RatingTour({ open, onClose }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[250] flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            className="max-h-[85dvh] w-full max-w-lg overflow-y-auto border border-amber-400/40 bg-[#0a0a0c] p-6 shadow-[0_0_60px_rgba(251,191,36,0.12)]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-amber-400">Рейтинг карточек</p>
            <h2 className="mt-2 font-display text-2xl text-white">Как считается рейтинг</h2>
            <p className="mt-3 font-mono text-[12px] leading-relaxed text-white/50">
              Нажмите «?» на странице юристов, чтобы открыть этот тур в любой момент.
            </p>

            <ol className="mt-6 space-y-4">
              {RATING_TOUR_STEPS.map((step, i) => (
                <motion.li
                  key={step.title}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06 }}
                  className="border border-white/10 p-4"
                >
                  <p className="font-mono text-[10px] uppercase tracking-wider text-amber-300/90">
                    {i + 1}. {step.title}
                  </p>
                  <p className="mt-2 font-mono text-[12px] leading-relaxed text-white/70">{step.body}</p>
                </motion.li>
              ))}
            </ol>

            <button
              type="button"
              onClick={onClose}
              className="mt-6 w-full border border-white/25 py-3 font-mono text-[11px] uppercase tracking-wider text-white hover:bg-white hover:text-black"
            >
              Понятно
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
