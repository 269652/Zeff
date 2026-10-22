"use client";

import { useEffect, useState } from "react";

/** How many rows a view draws at first, and how many more each time you come near its end. */
export const PROGRESSIVE_STEP = 100;

/**
 * A long view drawn in steps: the first rows at once, the next ones when you scroll near the end (a marker below the last row
 * drawn comes into view) — a database of 1,200 notes doesn't build 10,000 elements before the page shows. `limit`: how many to
 * draw; `marker`: the ref callback for the element after the last one drawn (render it only while `more > 0`).
 */
export function useProgressive(total: number, step = PROGRESSIVE_STEP) {
  const [limit, setLimit] = useState(step);
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (limit >= total || !el) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setLimit((l) => l + step), { rootMargin: "1200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [limit, total, step, el]);
  return { limit, more: Math.max(0, total - limit), marker: setEl as (el: HTMLElement | null) => void };
}
