"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Place = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };

/**
 * Its children, and on hover (or keyboard focus inside them) a floating card: under them, or
 * above when there's more room there — no taller than that room (it scrolls inside), kept in the
 * window. It stays while the pointer is on it, to click what's in it.
 */
export function HoverCard({ card, children, width = 420, className = "" }: { card: ReactNode; children: ReactNode; width?: number; className?: string }) {
  const [place, setPlace] = useState<Place | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const later = (fn: () => void, ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(fn, ms);
  };

  const show = () =>
    later(() => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const w = Math.min(width, window.innerWidth - 16);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
      const below = window.innerHeight - r.bottom - 14;
      const above = r.top - 14;
      setPlace(
        below >= 320 || below >= above
          ? { left, width: w, top: r.bottom + 6, maxHeight: below }
          : { left, width: w, bottom: window.innerHeight - r.top + 6, maxHeight: above },
      );
    }, 250);
  const hide = () => later(() => setPlace(null), 150);
  const keep = () => timer.current && clearTimeout(timer.current);

  return (
    <span ref={ref} className={`inline-flex max-w-full min-w-0 ${className}`} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {place &&
        createPortal(
          <div
            role="tooltip"
            style={{ position: "fixed", left: place.left, top: place.top, bottom: place.bottom, width: place.width, maxHeight: place.maxHeight }}
            className="z-50 overflow-y-auto rounded-lg text-left text-sm font-normal tracking-normal normal-case shadow-lg"
            onMouseEnter={keep}
            onMouseLeave={hide}
          >
            {card}
          </div>,
          document.body,
        )}
    </span>
  );
}
