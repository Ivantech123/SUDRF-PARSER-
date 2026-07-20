// Soft fade/slide between hash routes.

import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import type { Route } from "./Router.js";

export default function PageTransition({
  route,
  children,
}: {
  route: Route;
  children: ReactNode;
}) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={route}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
