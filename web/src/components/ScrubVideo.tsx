// Mouse-scrubbed video: horizontal mouse position maps to video currentTime,
// so moving the cursor left↔right scrubs through the clip frame by frame.
// Delta-based seeking: only call video.currentTime when the target moved
// enough, and chain via the `seeked` event so rapid scrubs don't queue.

import { useEffect, useRef } from "react";

interface Props {
  src: string;
  className?: string;
}

export default function ScrubVideo({ src, className }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const seekingRef = useRef(false);
  const targetRef = useRef(0);

  useEffect(() => {
    const video = ref.current;
    const container = containerRef.current;
    if (!video || !container) return;

    // Pause and let us drive currentTime manually.
    video.pause();

    const onLoaded = () => {
      // start at first frame
      video.currentTime = 0;
    };
    video.addEventListener("loadedmetadata", onLoaded);

    const onSeeked = () => {
      seekingRef.current = false;
      // if a newer target arrived while seeking, chase it
      if (Math.abs(video.currentTime - targetRef.current) > 0.05) {
        seekingRef.current = true;
        video.currentTime = targetRef.current;
      }
    };
    video.addEventListener("seeked", onSeeked);

    const onMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width; // 0..1
      const ratio = Math.max(0, Math.min(1, x));
      if (!video.duration) return;
      targetRef.current = ratio * video.duration;
      if (!seekingRef.current) {
        seekingRef.current = true;
        video.currentTime = targetRef.current;
      }
    };
    container.addEventListener("mousemove", onMove);

    // Touch: map touch X the same way for mobile.
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      const rect = container.getBoundingClientRect();
      const x = (t.clientX - rect.left) / rect.width;
      const ratio = Math.max(0, Math.min(1, x));
      if (!video.duration) return;
      targetRef.current = ratio * video.duration;
      if (!seekingRef.current) {
        seekingRef.current = true;
        video.currentTime = targetRef.current;
      }
    };
    container.addEventListener("touchmove", onTouch, { passive: true });

    return () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("seeked", onSeeked);
      container.removeEventListener("mousemove", onMove);
      container.removeEventListener("touchmove", onTouch);
    };
  }, []);

  return (
    <div ref={containerRef} className={className}>
      <video
        ref={ref}
        src={src}
        muted
        playsInline
        preload="auto"
        className="h-full w-full object-cover"
      />
    </div>
  );
}
