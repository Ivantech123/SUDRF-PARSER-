// 3D perspective text that tilts with the pointer, per the A2chatski prompt.
// useScroll/useSpring for smooth, lagging rotation; useTransform maps pointer
// position to rotateX/rotateY; useMotionTemplate composes the transform.

import { useRef } from "react";
import {
  motion,
  useMotionTemplate,
  useSpring,
  useTransform,
  useMotionValue,
} from "framer-motion";

interface Props {
  children: React.ReactNode;
  className?: string;
}

export default function TiltText({ children, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);

  const sx = useSpring(px, { stiffness: 120, damping: 20 });
  const sy = useSpring(py, { stiffness: 120, damping: 20 });

  const rotateX = useTransform(sy, [0, 1], [12, -12]);
  const rotateY = useTransform(sx, [0, 1], [-18, 18]);
  const transform = useMotionTemplate`perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;

  return (
    <motion.div
      ref={ref}
      style={{ transform }}
      className={className}
      onMouseMove={(e) => {
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        px.set((e.clientX - r.left) / r.width);
        py.set((e.clientY - r.top) / r.height);
      }}
      onMouseLeave={() => {
        px.set(0.5);
        py.set(0.5);
      }}
    >
      {children}
    </motion.div>
  );
}
