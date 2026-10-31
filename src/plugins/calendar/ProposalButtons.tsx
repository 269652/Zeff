"use client";

import { useT } from "@/components/I18nProvider";
import type { Item } from "./view-shared";

export type Decide = (item: Item, verdict: "accepted" | "dismissed") => void;

/**
 * On hover over a calendar's proposed appointment: accept it (an appointment like any other) or dismiss it (gone) — without
 * opening it. Shown while the pointer is over its `group` (and to the keyboard: focusable).
 */
export function ProposalButtons({ item, onDecide, className = "" }: { item: Item; onDecide?: Decide; className?: string }) {
  const t = useT();
  if (!onDecide || !item.event?.proposed) return null;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <span className={`flex gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 ${className}`} onPointerDown={stop} onClick={stop} onKeyDown={stop}>
      <button type="button" className="rounded bg-white/90 px-1 text-[11px] leading-4 font-semibold text-emerald-700 shadow-sm hover:bg-emerald-50 dark:bg-zinc-900/90 dark:text-emerald-400" onClick={() => onDecide(item, "accepted")} aria-label={t("Accept")} title={t("Accept")}>
        ✓
      </button>
      <button type="button" className="rounded bg-white/90 px-1 text-[11px] leading-4 font-semibold text-zinc-600 shadow-sm hover:bg-zinc-100 dark:bg-zinc-900/90 dark:text-zinc-300" onClick={() => onDecide(item, "dismissed")} aria-label={t("Dismiss")} title={t("Dismiss")}>
        ✕
      </button>
    </span>
  );
}
