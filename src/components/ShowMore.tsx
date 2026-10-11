"use client";

import { useT } from "./I18nProvider";

/** Of each kind, how many are shown before "Show more". */
export const PER_KIND = 3;

/**
 * Which items to show: of each kind the latest `max` (by `at`), in their order; items without a
 * kind (a todo, a note) always. The rest are `hidden` — shown when `all`.
 */
export function latestPerKind<T>(items: T[], kindOf: (t: T) => { kind: string; at: string } | null, all = false, max = PER_KIND): { shown: T[]; hidden: number } {
  if (all) return { shown: items, hidden: 0 };
  const byKind = new Map<string, { t: T; at: string }[]>();
  for (const t of items) {
    const k = kindOf(t);
    if (k) byKind.set(k.kind, [...(byKind.get(k.kind) ?? []), { t, at: k.at }]);
  }
  const keep = new Set<T>();
  for (const list of byKind.values()) for (const x of [...list].sort((a, b) => b.at.localeCompare(a.at)).slice(0, max)) keep.add(x.t);
  const shown = items.filter((t) => !kindOf(t) || keep.has(t));
  return { shown, hidden: items.length - shown.length };
}

/** "Show 4 more" / "Show less" — under a list cut to the latest of each kind. */
export function ShowMoreToggle({ hidden, open, onToggle, className = "" }: { hidden: number; open: boolean; onToggle: () => void; className?: string }) {
  const t = useT();
  if (!open && !hidden) return null;
  return (
    <button type="button" onClick={onToggle} className={`text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400 ${className}`} aria-expanded={open}>
      {open ? t("Show less") : t("Show {n} more", { n: hidden })}
    </button>
  );
}
