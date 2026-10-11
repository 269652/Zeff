"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setTodoDueAction } from "@/plugins/todos/server-actions";
import { dueText, dueTone } from "@/lib/boards/due-shared";
import { formatDate } from "@/lib/format";
import { toast } from "../Toaster";
import { useT } from "@/components/I18nProvider";

/**
 * A todo's deadline in its line: when it's due (red when today or past, amber within three days)
 * — set, changed or taken away by a click (a date field). Without one, a quiet "Frist" on hover.
 */
export function DueBadge({ todoId, due, closed }: { todoId: number; due: string | null; closed: boolean }) {
  const t = useT();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const save = (v: string | null) =>
    start(async () => {
      const r = await setTodoDueAction(todoId, v);
      if (!r?.ok) toast(r?.error ?? t("Didn't work."), { tone: "error" });
      setEditing(false);
      router.refresh();
    });
  if (closed && !due) return null;
  if (editing)
    return (
      <span className="inline-flex items-center gap-1">
        {" · "}
        <input
          type="date"
          className="rounded border border-zinc-300 px-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
          defaultValue={due ?? ""}
          autoFocus
          disabled={pending}
          aria-label={t("Due date")}
          onChange={(e) => e.target.value && save(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          onBlur={() => setEditing(false)}
        />
        {due && (
          <button type="button" className="hover:text-zinc-700 hover:underline" onMouseDown={(e) => e.preventDefault()} onClick={() => save(null)}>
            {t("no due date")}
          </button>
        )}
      </span>
    );
  return due ? (
    <>
      {" · "}
      <button type="button" className={`hover:underline ${closed ? "text-zinc-400" : dueTone(due)}`} onClick={() => !closed && setEditing(true)} title={t("Due: {date} — change", { date: formatDate(due, { year: true }) })}>
        {dueText(due, t)}
      </button>
    </>
  ) : (
    <button type="button" className="opacity-0 transition group-hover:opacity-100 hover:text-zinc-600 hover:underline focus:opacity-100" onClick={() => setEditing(true)} title={t("Set a due date")}>
      {" · "}{t("due date")}
    </button>
  );
}
