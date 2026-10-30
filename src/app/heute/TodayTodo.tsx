"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setTodoStatusConfirmed } from "@/components/boards/todo-status";
import { useT } from "@/components/I18nProvider";
import { TodoCheck } from "@/components/TodoCheck";

/**
 * A todo of Today's due list, done in place: its checkbox ticks it (done), ✕ dismisses it — either way it leaves the list (as in
 * the person's todos widget). `when` is its due, as the page words it.
 */
export function TodayTodo({ id, todoRef, text, when, overdue }: { id: number; todoRef: string; text: string; when: string; overdue: boolean }) {
  const t = useT();
  const router = useRouter();
  const [gone, setGone] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  if (gone) return null;
  const set = (status: "done" | "dismissed") =>
    start(async () => {
      const r = await setTodoStatusConfirmed(id, status);
      if (r?.ok) {
        setGone(true);
        router.refresh();
      } else if (r && !r.cancelled) setError(r.error ?? t("Didn't work."));
    });
  return (
    <li className="group flex items-baseline gap-2 text-sm">
      <TodoCheck label={text} disabled={pending} onChange={() => set("done")} className="translate-y-0.5 accent-indigo-600" />
      <span className="min-w-0 flex-1">
        {text}
        {error && <span className="ml-2 text-xs text-red-600 dark:text-red-400">{error}</span>}
      </span>
      <span className={`shrink-0 text-xs ${overdue ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>{when}</span>
      <Link href={`/t/${id}`} className="shrink-0 font-mono text-xs text-zinc-400 hover:underline">
        {todoRef}
      </Link>
      <button type="button" disabled={pending} onClick={() => set("dismissed")} aria-label={t("Dismiss")} title={t("Dismiss — not to be done")} className="shrink-0 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
        ✕
      </button>
    </li>
  );
}
