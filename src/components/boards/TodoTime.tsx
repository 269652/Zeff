"use client";

import { useState } from "react";
import type { ActionState } from "@/app/action-helpers";
import { addTodoTimeAction, deleteTodoTimeAction } from "@/plugins/todos/server-actions";
import { formatDateTime } from "@/lib/format";
import { formatMinutes, type TimeRecord } from "@/lib/work/shared";
import { useT } from "@/components/I18nProvider";
import { toast } from "../Toaster";

/** How long a save may take before the form is free again (said so). */
const SLOW_MS = 30000;

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
  // Its own busy state, not a transition: a transition stays pending while the page re-renders after the save — and forever
  // when the request was dropped (a dev server reloading, the network) — the button stayed off and nothing was saved.
  const [pending, setPending] = useState(false);
  // What you added or deleted here, shown at once: the page's refresh (on the "work" change) renders the whole page and comes
  // seconds later — until then the list looked as if nothing was saved.
  const [added, setAdded] = useState<TimeRecord[]>([]);
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const shown = [...time, ...added.filter((a) => !time.some((r) => r.id === a.id))].filter((r) => !removed.has(r.id));
  const total = shown.reduce((a, r) => a + r.minutes, 0);
  /** One call: its answer — or, after SLOW_MS without one, the form free again, saying it may still be saved; an error said. */
  const call = async <R extends ActionState>(fn: () => Promise<R>): Promise<R | null> => {
    setPending(true);
    try {
      const r = await Promise.race([fn(), new Promise<"slow">((done) => setTimeout(() => done("slow"), SLOW_MS))]);
      if (r === "slow") {
        toast(t("Zeff hasn't answered for 30 seconds — it may still save it. Look at the list in a moment before you add it again."), { tone: "error" });
        return null;
      }
      if (!r?.ok) {
        toast(r?.error ?? t("Didn't work."), { tone: "error" });
        return null;
      }
      return r;
    } catch (e) {
      toast(t("Zeff couldn't be reached: {error}", { error: e instanceof Error ? e.message : String(e) }), { tone: "error" });
      return null;
    } finally {
      setPending(false);
    }
  };
  const add = async () => {
    const m = Number(minutes.replace(",", "."));
    if (!(m > 0) || pending) return;
    // Cleared only once it's saved: a failed or unanswered save keeps what you typed.
    const r = await call(() => addTodoTimeAction(todoId, m, note));
    if (r) {
      if (r.record) setAdded((a) => [...a, r.record!]);
      setMinutes("");
      setNote("");
    }
  };
  const remove = async (id: number) => {
    if (await call(() => deleteTodoTimeAction(id))) setRemoved((s) => new Set([...s, id]));
  };
  return (
    <div className="mt-1.5 space-y-1.5 rounded-md border border-zinc-200 p-2 text-xs dark:border-zinc-700">
      {shown.length > 0 && (
        <ul className="space-y-0.5">
          {shown.map((r) => (
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
                <button type="button" className="icon-btn text-base" disabled={pending} onClick={() => void remove(r.id)} title={t("Delete this time record")} aria-label={t("Delete {ref}", { ref: r.ref })}>
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
          onKeyDown={(e) => e.key === "Enter" && void add()}
        />
        <button type="button" className="btn btn-sm btn-primary" onClick={() => void add()} disabled={pending || !(Number(minutes.replace(",", ".")) > 0)}>
          {pending ? t("Saving…") : t("Add time")}
        </button>
        <button type="button" className="btn btn-sm" onClick={onClose}>
          {t("Close")}
        </button>
        {shown.length > 0 && <span className="text-zinc-400">{t("Total {time}", { time: formatMinutes(total) })}</span>}
      </div>
    </div>
  );
}
