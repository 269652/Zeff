"use client";

import { createContext, useContext, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { BADGE_DOTS, BADGE_DOTS_SOFT, BADGE_MARKS, BADGE_TONES, BADGE_TONES_DIM } from "@/lib/badges/palette";
import { DEFAULT_WS_BADGES, type WsBadgeConfig } from "../badge-config";
import { countLabel, shownBadge, shownMessages, shownTodos, type Badge } from "../badge-shared";

/** The colours of the tree's badges (Settings → Badges); which kinds are shown at all is settled on the server (badges.ts). */
const LookContext = createContext<WsBadgeConfig["tones"]>(DEFAULT_WS_BADGES.tones);

export function TreeBadgeLook({ tones, children }: { tones?: WsBadgeConfig["tones"]; children: React.ReactNode }) {
  return <LookContext.Provider value={tones ?? DEFAULT_WS_BADGES.tones}>{children}</LookContext.Provider>;
}

/** A badge in the tree: a pill on the right — what waits, late or gone wrong a dot in it, activity a dot; `dim`: what is below it (paler). */
export function BadgePill({ badge, dim = false }: { badge: Badge | null | undefined; dim?: boolean }) {
  const t = useT();
  const look = useContext(LookContext);
  const s = shownBadge(badge);
  const msgs = shownMessages(badge);
  const todos = shownTodos(badge);
  const pill = (color: (typeof look)[keyof typeof look]["color"]) => (dim ? BADGE_TONES_DIM[color] : BADGE_TONES[color]);
  // Open todos: a pill of their own with a box (in the "important" colour when some are late) — first, beside what else waits.
  const todo = todos.n > 0 && (
    <span
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 text-[11px] font-semibold tabular-nums leading-4 ${pill(look.todos.color)}`}
      data-badge="todos"
      title={todos.late ? t("{n} open, {late} late", { n: todos.n, late: todos.late }) : t("{n} open todos", { n: todos.n })}
    >
      <span aria-hidden className={todos.late ? BADGE_MARKS[look.important.color] : ""}>☐</span>
      <span aria-hidden>{countLabel(todos.n)}</span>
      <span className="sr-only">{todos.late ? t("{n} open todos, {late} of them late", { n: todos.n, late: todos.late }) : t("{n} open todos", { n: todos.n })}</span>
    </span>
  );
  if (todo) {
    const rest = { ...badge!, todos: 0, todosLate: 0 };
    return (
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {todo}
        {(shownBadge(rest) || shownMessages(rest) > 0) && <BadgePill badge={rest} dim={dim} />}
      </span>
    );
  }
  // Unread messages from someone: a pill of their own (✉), beside what waits — not mixed into the todos.
  const mail = msgs > 0 && (
    <span
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 text-[11px] font-semibold tabular-nums leading-4 ${pill(look.messages.color)} ${s ? "" : "ml-auto"}`}
      data-badge="messages"
      title={t("{n} unread messages", { n: msgs })}
    >
      <span aria-hidden>✉ {countLabel(msgs)}</span>
      <span className="sr-only">{t("{n} unread messages", { n: msgs })}</span>
    </span>
  );
  if (!s) return mail || null;
  if (mail)
    return (
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {mail}
        <BadgePill badge={{ ...badge!, messages: 0 }} dim={dim} />
      </span>
    );
  const label =
    s.tone === "important" ? t("{n} waiting, {late} of them late", { n: s.count, late: s.late ?? 0 }) : s.tone === "unread" ? t("{n} unread", { n: s.count }) : t("Changed since you last opened it");
  const said = dim ? t("Below: {what}", { what: label }) : label;
  if (s.tone === "activity")
    return (
      <span className="ml-auto flex shrink-0 items-center pl-1" data-badge="activity" title={said}>
        <span aria-hidden className={`rounded-full ${dim ? "size-1.5 bg-zinc-400 dark:bg-zinc-500" : `size-2 ${BADGE_DOTS_SOFT[look.activity.color]}`}`} />
        <span className="sr-only">{said}</span>
      </span>
    );
  // One look for every pill (a page's own and what is below it — that one only paler); something late: a dot in it.
  return (
    <span
      className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 text-[11px] font-semibold tabular-nums leading-4 ${pill(look.unread.color)}`}
      data-badge={s.tone}
      title={said}
      {...(!dim ? { "data-unread": true } : {})}
    >
      {s.tone === "important" && <span aria-hidden className={`size-1.5 rounded-full ${BADGE_DOTS[look.important.color]}`} />}
      <span aria-hidden>{countLabel(s.count)}</span>
      <span className="sr-only">{said}</span>
    </span>
  );
}

/** Badges shown at all (a pill or a dot). */
export const showsBadge = (b: Badge | null | undefined) => !!b && (!!shownBadge(b) || shownMessages(b) > 0 || shownTodos(b).n > 0);

/** How many pills a badge shows, and the sum of what they count. */
function pillsOf(b: Badge | null | undefined): { pills: number; sum: number } {
  const s = shownBadge(b);
  const m = shownMessages(b);
  const td = shownTodos(b).n;
  return { pills: (s ? 1 : 0) + (m > 0 ? 1 : 0) + (td > 0 ? 1 : 0), sum: (s?.count ?? 0) + m + td };
}

/** A row's badges (People and its persons): more than two pills fold behind a chevron and their sum — with the "changed since you last opened it" dot when something is new; a click unfolds them. */
export function FoldedBadge({ badge, below }: { badge: Badge | null | undefined; /** What is below it (shown paler). */ below?: Badge | null }) {
  const t = useT();
  const [unfolded, setUnfolded] = useState(false);
  if (!showsBadge(badge) && !showsBadge(below)) return null;
  const own = pillsOf(badge);
  const sub = pillsOf(below);
  const pills = (
    <>
      {showsBadge(badge) && <BadgePill badge={badge} />}
      {showsBadge(below) && <span className={showsBadge(badge) ? "shrink-0" : "ml-auto shrink-0"}><BadgePill badge={below} dim /></span>}
    </>
  );
  if (own.pills + sub.pills <= 2) return pills;
  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setUnfolded((x) => !x);
  };
  const sum = own.sum + sub.sum;
  const fresh = (badge?.activity ?? 0) > 0 || (below?.activity ?? 0) > 0;
  const tip = unfolded ? (fresh ? `${t("Fold")} · ${t("Changed since you last opened it")}` : t("Fold")) : fresh ? `${t("Show what waits")} · ${t("Changed since you last opened it")}` : t("Show what waits");
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1">
      <button
        type="button"
        className="flex h-4 shrink-0 items-center gap-1 rounded px-0.5 text-[11px] font-semibold text-zinc-500 tabular-nums hover:bg-zinc-200/70 dark:text-zinc-400 dark:hover:bg-zinc-700/60"
        onClick={toggle}
        title={tip}
        aria-label={tip}
        aria-expanded={unfolded}
      >
        <span aria-hidden className="text-[10px]">{unfolded ? "▸" : "◂"}</span>
        {fresh && <span aria-hidden className="size-1.5 rounded-full bg-sky-500 dark:bg-sky-400" />}
        {!unfolded && sum > 0 && <span className={fresh ? "text-sky-700 dark:text-sky-300" : ""}>{countLabel(sum)}</span>}
      </button>
      {unfolded && pills}
    </span>
  );
}
