"use client";

import type { ReactNode } from "react";
import { ChevronIcon } from "./icons";
import { useT } from "@/components/I18nProvider";

/**
 * The tones of the kinds of context: the card's soft tint and border, the round icon tile, the kind
 * label, the footer link. Whole class names, so Tailwind sees them.
 */
const TONES = {
  violet: { card: "border-violet-200/70 bg-violet-50/70 dark:border-violet-900/60 dark:bg-violet-950/30", tile: "bg-violet-100 text-violet-700 dark:bg-violet-900/60 dark:text-violet-200", label: "text-violet-800 dark:text-violet-200", foot: "text-violet-700 hover:bg-violet-100/70 dark:text-violet-300 dark:hover:bg-violet-900/40" },
  sky: { card: "border-sky-200/70 bg-sky-50/70 dark:border-sky-900/60 dark:bg-sky-950/30", tile: "bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-200", label: "text-sky-800 dark:text-sky-200", foot: "text-sky-700 hover:bg-sky-100/70 dark:text-sky-300 dark:hover:bg-sky-900/40" },
  emerald: { card: "border-emerald-200/70 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/30", tile: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200", label: "text-emerald-800 dark:text-emerald-200", foot: "text-emerald-700 hover:bg-emerald-100/70 dark:text-emerald-300 dark:hover:bg-emerald-900/40" },
  orange: { card: "border-orange-200/70 bg-orange-50/70 dark:border-orange-900/60 dark:bg-orange-950/30", tile: "bg-orange-100 text-orange-700 dark:bg-orange-900/60 dark:text-orange-200", label: "text-orange-800 dark:text-orange-200", foot: "text-orange-700 hover:bg-orange-100/70 dark:text-orange-300 dark:hover:bg-orange-900/40" },
  amber: { card: "border-amber-200/70 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/30", tile: "bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200", label: "text-amber-800 dark:text-amber-200", foot: "text-amber-800 hover:bg-amber-100/70 dark:text-amber-300 dark:hover:bg-amber-900/40" },
  teal: { card: "border-teal-200/70 bg-teal-50/70 dark:border-teal-900/60 dark:bg-teal-950/30", tile: "bg-teal-100 text-teal-700 dark:bg-teal-900/60 dark:text-teal-200", label: "text-teal-800 dark:text-teal-200", foot: "text-teal-700 hover:bg-teal-100/70 dark:text-teal-300 dark:hover:bg-teal-900/40" },
  indigo: { card: "border-indigo-200/70 bg-indigo-50/70 dark:border-indigo-900/60 dark:bg-indigo-950/30", tile: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-200", label: "text-indigo-800 dark:text-indigo-200", foot: "text-indigo-700 hover:bg-indigo-100/70 dark:text-indigo-300 dark:hover:bg-indigo-900/40" },
  rose: { card: "border-rose-200/70 bg-rose-50/70 dark:border-rose-900/60 dark:bg-rose-950/30", tile: "bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-200", label: "text-rose-800 dark:text-rose-200", foot: "text-rose-700 hover:bg-rose-100/70 dark:text-rose-300 dark:hover:bg-rose-900/40" },
  zinc: { card: "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900", tile: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300", label: "text-zinc-600 dark:text-zinc-300", foot: "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800" },
} as const;
export type CardTone = keyof typeof TONES;

export type SourceCardProps = {
  tone: CardTone;
  /** The kind's icon (an svg, sized by the card). */
  icon: ReactNode;
  /** The kind in a word, small above the title: "Mail", "Teams · Chat", "Merge request". */
  kind: string;
  /** When it happened, in the footer — already formatted. */
  when?: string;
  /** The headline: the subject, the title, the file's name. */
  title: string;
  /** Under it: who, where. */
  sub?: string;
  /** Its first words. */
  snippet?: string;
  /** A picture of it, shown at the top of the card (an address). */
  thumb?: string;
  /** A state as a small pill: "merged", "unread" — its colours are the caller's. */
  state?: { text: string; className?: string };
  /** A mark beside the kind (a "done" check). */
  mark?: ReactNode;
  /** Unfolds — with the chevron. */
  expanded?: boolean;
  onToggle?: () => void;
  toggleTitle?: string;
  /** Opens it where it lives (a link in the footer). */
  href?: string;
  hrefTitle?: string;
  className?: string;
};

/**
 * One piece of context as a small, tall card: a round icon with the kind (and its state), the
 * title in full, who/where, its first words, a picture where there is one — and at the foot when it
 * happened and a link to where it lives. The card of Mail, Teams, GitLab, Jira, notes, documents …
 * so a context list reads as one masonry of friendly cards, not as ragged chips.
 */
export function SourceCard({ tone, icon, kind, when, title, sub, snippet, thumb, state, mark, expanded = false, onToggle, toggleTitle, href, hrefTitle, className = "" }: SourceCardProps) {
  const t = useT();
  const c = TONES[tone];
  const body = (
    <>
      {thumb && (
        // eslint-disable-next-line @next/next/no-img-element -- a stored file of the app itself (/api/documents/…), at thumbnail size
        <img src={thumb} alt="" loading="lazy" className="aspect-[4/3] w-full rounded-xl border border-black/5 bg-white object-cover dark:border-white/10 dark:bg-zinc-800" />
      )}
      <span className="flex min-w-0 items-center gap-2">
        <span className={`flex size-8 shrink-0 items-center justify-center rounded-full [&>svg]:size-[18px] ${c.tile}`} aria-hidden>
          {icon}
        </span>
        <span className={`min-w-0 flex-1 truncate text-xs font-semibold tracking-wide uppercase ${c.label}`}>{kind}</span>
        {mark}
        {onToggle && <ChevronIcon open={expanded} className="size-4 shrink-0 text-zinc-500 dark:text-zinc-400" />}
      </span>
      {state && <span className={`w-fit rounded-full px-2 py-0.5 text-xs font-medium ${state.className ?? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"}`}>{state.text}</span>}
      <span className="line-clamp-3 text-[15px] leading-snug font-semibold break-words text-zinc-900 dark:text-zinc-50">{title}</span>
      {sub && <span className="line-clamp-2 text-xs leading-snug break-words text-zinc-600 dark:text-zinc-400">{sub}</span>}
      {snippet && <span className="line-clamp-5 text-[13px] leading-relaxed break-words text-zinc-700 dark:text-zinc-300">{snippet}</span>}
    </>
  );
  const main = "flex min-w-0 flex-1 flex-col gap-2 p-3.5 text-left";
  return (
    <div className={`flex min-w-0 flex-col overflow-hidden rounded-2xl border shadow-sm transition duration-150 hover:shadow-md motion-safe:hover:-translate-y-0.5 ${c.card} ${className}`}>
      {onToggle ? (
        <button type="button" className={`${main} cursor-pointer rounded-t-2xl`} onClick={onToggle} aria-expanded={expanded} title={toggleTitle ?? (expanded ? t("Fold") : t("Show more"))}>
          {body}
        </button>
      ) : (
        <span className={main}>{body}</span>
      )}
      {(when || href) && (
        <span className="flex min-w-0 items-center justify-between gap-2 border-t border-black/5 px-3.5 py-1.5 text-xs text-zinc-600 dark:border-white/10 dark:text-zinc-400">
          <span className="min-w-0 truncate">{when}</span>
          {href && (
            <a href={href} target="_blank" rel="noreferrer" className={`-mr-2 flex shrink-0 items-center gap-1 rounded-md px-2 py-1 font-medium transition ${c.foot}`} title={hrefTitle} aria-label={hrefTitle ?? t("Open")}>
              {t("Open")} <span aria-hidden>↗</span>
            </a>
          )}
        </span>
      )}
    </div>
  );
}
