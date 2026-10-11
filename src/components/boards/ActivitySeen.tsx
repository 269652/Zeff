"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useT } from "@/components/I18nProvider";
import { ACTIVITY_SEEN_EVENT, ACTIVITY_SEEN_KEY } from "@/lib/boards/activity-shared";

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

/** A red count of todo changes you haven't seen yet. */
export function UnseenActivityBadge({ ids, className = "" }: { ids: number[]; className?: string }) {
  const t = useT();
  const n = useUnseenActivity(ids);
  if (!n) return null;
  return (
    <span
      className={`inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] leading-4 font-semibold text-white normal-case ${className}`}
      title={n === 1 ? t("1 change to todos you haven't seen yet") : t("{n} changes to todos you haven't seen yet", { n })}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}
