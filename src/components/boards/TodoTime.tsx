"use client";

import { useState, useTransition } from "react";
import { addTodoTimeAction, deleteTodoTimeAction } from "@/plugins/todos/server-actions";
import { formatDateTime } from "@/lib/format";
import { formatMinutes, type TimeRecord } from "@/lib/work/shared";
import { useT } from "@/components/I18nProvider";
import { toast } from "../Toaster";

/** The minutes of a todo's records not booked (or marked not to be). */
export const openMinutes = (time: TimeRecord[] = []) => time.filter((r) => r.entryId == null).reduce((a, r) => a + r.minutes, 0);

/**
 * The time on a todo: its records (who, how long, what, when — an agent's reports and yours),
 * each deletable while no booking covers it, and a line to add your own (minutes + what).
 * They add up into the booking suggestion with the todos related to it.
 */
export function TodoTimePanel({ todoId, time = [], onClose }: { todoId: number; time?: TimeRecord[]; onClose: () => void }) {
  const t = useT();
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const total = time.reduce((a, r) => a + r.minutes, 0);
  const add = () => {
    const m = Number(minutes.replace(",", "."));
    if (!(m > 0) || pending) return;
    start(async () => {
      const r = await addTodoTimeAction(todoId, m, note);
      if (!r?.ok) {
        toast(r?.error ?? t("Didn't work."), { tone: "error" });
        return;
      }
      setMinutes("");
      setNote("");
    });
  };
  const remove = (id: number) =>
    start(async () => {
      const r = await deleteTodoTimeAction(id);
      if (!r?.ok) toast(r?.error ?? t("Didn't work."), { tone: "error" });
    });
  return (
    <div className="mt-1.5 space-y-1.5 rounded-md border border-zinc-200 p-2 text-xs dark:border-zinc-700">
      {time.length > 0 && (
        <ul className="space-y-0.5">
          {time.map((r) => (
            <li key={r.id} className="flex items-baseline gap-2">
              <span className="w-16 shrink-0 text-right font-mono">{formatMinutes(r.minutes)}</span>
              <span className="min-w-0 flex-1 truncate" title={r.note}>
                {r.note || <span className="text-zinc-400">—</span>}
                <span className="text-zinc-400">
                  {" "}
                  · {r.source === "hand" ? t("You") : r.by} · {formatDateTime(r.at)}
                  {r.entryId != null && r.entryId > 0 ? ` · ${t("booked")}` : r.suggestionId != null ? ` · S-${r.suggestionId}` : ""}
                </span>
              </span>
              {r.entryId == null && r.suggestionId == null && (
                <button type="button" className="icon-btn text-base" disabled={pending} onClick={() => remove(r.id)} title={t("Delete this time record")} aria-label={t("Delete {ref}", { ref: r.ref })}>
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <input className="input w-20 text-sm" inputMode="numeric" placeholder={t("min")} value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label={t("Minutes")} disabled={pending} />
        <input
          className="input min-w-40 flex-1 text-sm"
          placeholder={t("What was done (one line)")}
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
          aria-label={t("What was done")}
          disabled={pending}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button type="button" className="btn btn-sm btn-primary" onClick={add} disabled={pending || !(Number(minutes.replace(",", ".")) > 0)}>
          {t("Add time")}
        </button>
        <button type="button" className="btn btn-sm" onClick={onClose}>
          {t("Close")}
        </button>
        {time.length > 0 && <span className="text-zinc-400">{t("Total {time}", { time: formatMinutes(total) })}</span>}
      </div>
    </div>
  );
}
