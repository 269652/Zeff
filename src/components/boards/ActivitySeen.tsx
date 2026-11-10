"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useBadgeLook } from "@/components/BadgeLookProvider";
import { useT } from "@/components/I18nProvider";
import { BADGE_TONES } from "@/lib/badges/palette";
import { ACTIVITY_SEEN_EVENT, ACTIVITY_SEEN_KEY } from "@/lib/todos/activity-shared";

/** The newest todo event seen in this browser (null: never looked). */
export function readActivitySeen(): number | null {
  try {
    const v = localStorage.getItem(ACTIVITY_SEEN_KEY);
    return v === null ? null : Number(v) || 0;
  } catch {
    return null;
  }
}

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(ACTIVITY_SEEN_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(ACTIVITY_SEEN_EVENT, cb);
  };
}

/** Everything up to this event: seen. */
export function markActivitySeen(id: number) {
  try {
    if ((readActivitySeen() ?? 0) >= id) return;
    localStorage.setItem(ACTIVITY_SEEN_KEY, String(id));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(ACTIVITY_SEEN_EVENT));
}

/** How many of these events (news: not your own clicks) you haven't seen on the Aktivität tab. */
export function useUnseenActivity(ids: number[]): number {
  const seen = useSyncExternalStore(subscribe, readActivitySeen, () => null);
  const max = ids.length ? Math.max(...ids) : 0;
  // Never looked: what's there so far counts as seen — the badge is for what comes.
  useEffect(() => {
    if (max && readActivitySeen() === null) markActivitySeen(max);
  }, [max]);
  return seen === null ? 0 : ids.filter((id) => id > seen).length;
}

/** A count of todo changes you haven't seen yet — in its colour, or none (Settings → Badges). `count`: a given number (the settings' preview). */
export function UnseenActivityBadge({ ids, count, className = "" }: { ids: number[]; count?: number; className?: string }) {
  const t = useT();
  const look = useBadgeLook().todoActivity;
  const unseen = useUnseenActivity(ids);
  const n = count ?? unseen;
  if (!n || !look.on) return null;
  return (
    <span
      className={`inline-flex min-w-[1.1rem] items-center justify-center rounded-full px-1 text-xs leading-4 font-semibold ${BADGE_TONES[look.color]} normal-case ${className}`}
      title={n === 1 ? t("1 change to todos you haven't seen yet") : t("{n} changes to todos you haven't seen yet", { n })}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}
