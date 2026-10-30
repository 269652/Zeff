"use client";

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "./I18nProvider";
import { useDismiss } from "@/components/useDismiss";

type Place = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };

/** Width of the side panel when a card inside it asks for one. */
const SIDE_WIDTH = 340;

/**
 * What a card inside a HoverCard (or its trigger) can ask of it: show this beside the card as a
 * sidebar — instead of floating a second card on top of the first (a person named in a note) —
 * and open the card if it isn't open yet. Null outside any HoverCard.
 */
const SideCtx = createContext<{ setSide: (node: ReactNode | null) => void; open: () => void; /** The card has a sidebar of its own already (its `side` prop). */ hasSide: boolean } | null>(null);
export const useHoverSide = () => useContext(SideCtx);

/**
 * Its children, and on hover (or keyboard focus inside them) a floating card: under them, or
 * above when there's more room there — no taller than that room (it scrolls inside), kept in the
 * window. It stays while the pointer is on it, to click what's in it.
 */
export function HoverCard({ card, children, width = 420, className = "", side: sideProp, label, delay = 250 }: { card: ReactNode; children: ReactNode; width?: number; className?: string; /** A sidebar beside the card, whenever it's open (the people a note names). */ side?: ReactNode; /** The card's accessible name. */ label?: string; /** How long the pointer (or focus) rests before it opens, ms. */ delay?: number }) {
  const t = useT();
  const id = useId();
  const [place, setPlace] = useState<Place | null>(null);
  const [asked, setSide] = useState<ReactNode | null>(null);
  const side = sideProp ?? asked;
  const ref = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchAt = useRef(0);
  const isOpen = !!place;

  // The trigger (the first child, when it can be focused) says it opens a dialog.
  useEffect(() => {
    const el = ref.current?.firstElementChild;
    if (!el || !el.matches("a[href], button, input, select, textarea, summary, [tabindex], [role=button], [role=link]")) return;
    el.setAttribute("aria-haspopup", "dialog");
    el.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) el.setAttribute("aria-controls", id);
    else el.removeAttribute("aria-controls");
  }, [isOpen, id]);

  // Open: Escape closes (1.4.13); a tap outside closes (touch).
  useDismiss([ref, cardRef], isOpen, () => setPlace(null), {
    event: "pointerdown",
    filter: (e) => (e as PointerEvent).pointerType !== "mouse",
    onEscape: () => {
      if (timer.current) clearTimeout(timer.current);
      setPlace(null);
    },
  });

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

  // The side panel goes with the card: closed, it's gone.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the sidebar belongs to the open card
    if (!place) setSide(null);
  }, [place]);

  const locate = () => {
      // Anchored at the element hovered (its first child: the badge, the button — not the wrapper).
      const r = (ref.current?.firstElementChild ?? ref.current)?.getBoundingClientRect();
      if (!r) return;
      // As wide as the column it's in (a table cell, a todo's text) — else its own width —, at
      // most 45% of the window, at least enough to read; starting under the element, shifted
      // left only as far as the window needs.
      const column = ref.current?.closest("td, [data-hover-column]")?.getBoundingClientRect();
      const fit = Math.min(window.innerWidth - 16, 280);
      const w = Math.max(fit, Math.min(column ? column.width : width, window.innerWidth * 0.45, window.innerWidth - 16));
      const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
      const below = window.innerHeight - r.bottom - 14;
      const above = r.top - 14;
      setPlace(
        below >= 320 || below >= above
          ? { left, width: w, top: r.bottom + 6, maxHeight: below }
          : { left, width: w, bottom: window.innerHeight - r.top + 6, maxHeight: above },
      );
  };
  // A touch fires emulated mouse/focus events after its pointerdown: those must not undo the toggle.
  const recentTouch = () => Date.now() - touchAt.current < 800;
  const show = () => {
    if (!recentTouch()) later(locate, delay);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
    touchAt.current = Date.now();
    if (place) later(() => setPlace(null), 0);
    else later(locate, 0);
  };
  const hasSide = !!sideProp;
  const api = useMemo(() => ({ setSide, open: () => later(locate, 0), hasSide }), [hasSide]); // eslint-disable-line react-hooks/exhaustive-deps
  const hide = () => later(() => setPlace(null), 150);
  const keep = () => timer.current && clearTimeout(timer.current);

  // With a side panel the card is wider: the card and the panel beside it, kept in the window.
  const total = place && (side ? Math.min(place.width + SIDE_WIDTH, window.innerWidth - 16) : place.width);
  const left = place && total ? Math.max(8, Math.min(place.left, window.innerWidth - total - 8)) : 0;
  return (
    <SideCtx.Provider value={api}>
      <span ref={ref} className={`inline-flex max-w-full min-w-0 ${className}`} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onPointerDown={onPointerDown}>
        {children}
        {place &&
          createPortal(
            <div
              ref={cardRef}
              id={id}
              role="dialog"
              aria-label={label ?? t("Details")}
              style={{ position: "fixed", left, top: place.top, bottom: place.bottom, width: total ?? place.width, maxHeight: place.maxHeight }}
              className="z-50 flex overflow-hidden rounded-lg text-left text-sm font-normal tracking-normal normal-case shadow-lg"
              onMouseEnter={keep}
              onMouseLeave={hide}
            >
              <div className="min-w-0 flex-1 overflow-y-auto">{card}</div>
              {side && (
                <aside className="w-[340px] max-w-[45%] shrink-0 overflow-y-auto border-l border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950" aria-label={t("Related")}>
                  {side}
                </aside>
              )}
            </div>,
            document.body,
          )}
      </span>
    </SideCtx.Provider>
  );
}
