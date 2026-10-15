"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Shows its content smaller — text, padding and pictures together — and still across the whole width: the
 * content is laid out `1/scale` as wide and scaled down (a transform, so it doesn't depend on how a browser
 * treats CSS zoom with percentage widths), and the box takes the scaled height so nothing below it leaves a gap.
 */
export function ScaledBox({ scale = 0.8, className = "", children }: { scale?: number; className?: string; children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);
  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    const measure = () => setHeight(Math.ceil(el.offsetHeight * scale));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scale]);
  return (
    <div className={className} style={{ height }}>
      <div ref={inner} style={{ width: `${100 / scale}%`, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        {children}
      </div>
    </div>
  );
}
