import { useEffect, useRef, type ComponentProps } from "react";
import { cn } from "../../lib/utils.js";

type WavePathProps = ComponentProps<"div">;

/** Interactive SVG wave — drag vertically to bend the path. */
export function WavePath({ className, ...props }: WavePathProps) {
  const path = useRef<SVGPathElement>(null);
  const progress = useRef(0);
  const x = useRef(0.2);
  const time = useRef(Math.PI / 2);
  const reqId = useRef<number | null>(null);
  const lastTouchY = useRef<number | null>(null);

  const setPath = (p: number) => {
    const width = window.innerWidth * 0.7;
    if (path.current) {
      path.current.setAttributeNS(
        null,
        "d",
        `M0 100 Q${width * x.current} ${100 + p * 0.6}, ${width} 100`,
      );
    }
  };

  useEffect(() => {
    setPath(progress.current);
    const onResize = () => setPath(progress.current);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (reqId.current) cancelAnimationFrame(reqId.current);
    };
  }, []);

  const lerp = (a: number, b: number, t: number) => a * (1 - t) + b * t;

  const resetAnimation = () => {
    time.current = Math.PI / 2;
    progress.current = 0;
  };

  const animateOut = () => {
    const newProgress = progress.current * Math.sin(time.current);
    progress.current = lerp(progress.current, 0, 0.025);
    time.current += 0.2;
    setPath(newProgress);
    if (Math.abs(progress.current) > 0.75) {
      reqId.current = requestAnimationFrame(animateOut);
    } else {
      resetAnimation();
      setPath(0);
    }
  };

  const managePointerEnter = () => {
    if (reqId.current) {
      cancelAnimationFrame(reqId.current);
      reqId.current = null;
      resetAnimation();
    }
  };

  const managePointerMove = (clientX: number, movementY: number) => {
    if (!path.current) return;
    const pathBound = path.current.getBoundingClientRect();
    x.current = (clientX - pathBound.left) / Math.max(1, pathBound.width);
    progress.current += movementY;
    setPath(progress.current);
  };

  const managePointerLeave = () => {
    lastTouchY.current = null;
    animateOut();
  };

  return (
    <div className={cn("relative h-px w-[70vw]", className)} {...props}>
      <div
        onMouseEnter={managePointerEnter}
        onMouseMove={(e) => managePointerMove(e.clientX, e.movementY)}
        onMouseLeave={managePointerLeave}
        onTouchStart={(e) => {
          managePointerEnter();
          lastTouchY.current = e.touches[0]?.clientY ?? null;
        }}
        onTouchMove={(e) => {
          const t = e.touches[0];
          if (!t) return;
          const prev = lastTouchY.current;
          const dy = prev != null ? t.clientY - prev : 0;
          lastTouchY.current = t.clientY;
          managePointerMove(t.clientX, dy);
        }}
        onTouchEnd={managePointerLeave}
        className="relative -top-5 z-10 h-10 w-full touch-none hover:-top-[150px] hover:h-[300px]"
      />
      <svg className="pointer-events-none absolute -top-[100px] h-[300px] w-full" aria-hidden>
        <path ref={path} className="fill-none stroke-current" strokeWidth={2} />
      </svg>
    </div>
  );
}
