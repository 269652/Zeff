"use client";

import { useEffect, useRef, type RefObject } from "react";

export type DismissOptions = {
  /** Escape closes too (default true). */
  escape?: boolean;
  /** What Escape does instead of `fn` (a menu gives the focus back to its button). */
  onEscape?: () => void;
  /** The press that counts as outside (default "mousedown"). */
  event?: "mousedown" | "pointerdown";
  /** Only presses this accepts count (e.g. not a mouse: a hover card closes on a tap outside). */
  filter?: (e: MouseEvent) => boolean;
  /** Listen from the next tick on: the press that opened it (when it opens on a press) does not close it again. */
  defer?: boolean;
};

/**
 * Calls `fn` on a press outside `ref` (or outside all of `refs`: a button and its portalled menu) or on Escape — while `active`.
 */
export function useDismiss(refs: RefObject<HTMLElement | null> | RefObject<HTMLElement | null>[], active: boolean, fn: () => void, opts: DismissOptions = {}) {
  const cb = useRef(fn);
  const list = useRef(refs);
  const filter = useRef(opts.filter);
  const esc = useRef(opts.onEscape);
  useEffect(() => {
    cb.current = fn;
    list.current = refs;
    filter.current = opts.filter;
    esc.current = opts.onEscape;
  });
  const { escape = true, event = "mousedown", defer = false } = opts;
  useEffect(() => {
    if (!active) return;
    // (Nothing mounted yet: nothing to be outside of.)
    const inside = (n: Node) => {
      const els = (Array.isArray(list.current) ? list.current : [list.current]).map((r) => r.current).filter((el) => !!el);
      return !els.length || els.some((el) => el.contains(n));
    };
    const down = (e: MouseEvent) => {
      if (filter.current && !filter.current(e)) return;
      if (!inside(e.target as Node)) cb.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") (esc.current ?? cb.current)();
    };
    const listen = () => document.addEventListener(event, down);
    const timer = defer ? setTimeout(listen, 0) : null;
    if (!defer) listen();
    if (escape) document.addEventListener("keydown", key);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener(event, down);
      document.removeEventListener("keydown", key);
    };
  }, [active, escape, event, defer]);
}
