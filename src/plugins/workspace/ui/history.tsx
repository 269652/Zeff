"use client";

import { useCallback, useEffect, useState } from "react";
import { confirmAction } from "@/components/confirm";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { undoAction, undoEntriesAction, undoPreviewAction } from "../actions";
import type { UndoEntry } from "../undo";

const ACTOR = { you: "👤", ai: "✨", source: "⚙️" } as const;

/** The recent actions that can be undone as a whole - what the AI did in an answer or a tool call, what an automation did in a run, a bulk edit - newest first. */
export function HistoryList() {
  const t = useT();
  const [entries, setEntries] = useState<UndoEntry[] | null>(null);
  const load = useCallback(async () => {
    const r = await undoEntriesAction();
    if (r.ok) setEntries(r.entries);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- read when shown (the state is set once the answer is there)
  useEffect(() => void load(), [load]);

  const revert = async (e: UndoEntry) => {
    const p = await undoPreviewAction(e.id);
    const later = p.ok ? p.newerEdits : 0;
    if (!confirmAction(later ? t("Undo “{label}”? {n} of its {pages} pages were changed again since — those changes are lost too.", { label: e.label, n: later, pages: e.pages }) : t("Undo “{label}”? {pages} pages go back as they were.", { label: e.label, pages: e.pages }))) return;
    const r = await undoAction(e.id);
    if (!r.ok) toast(r.error, { tone: "error" });
    else toast(t("{restored} pages put back, {trashed} sent to the trash.", { restored: r.restored, trashed: r.trashed }), { tone: "ok" });
    void load();
  };

  if (!entries) return <p className="text-sm text-zinc-400">…</p>;
  if (!entries.length) return <p className="text-sm text-zinc-500">{t("Nothing yet — the AI's answers, automation runs and bulk edits show up here.")}</p>;
  return (
    <ul className="card divide-y divide-zinc-100 dark:divide-zinc-800">
      {entries.map((e) => (
        <li key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm">
          <span aria-hidden title={e.actor}>
            {ACTOR[e.actor]}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{e.label}</span>
            <span className="text-xs text-zinc-500">
              {new Date(e.at).toLocaleString()} · {t("{n} pages", { n: e.pages })}
              {e.undone ? ` · ${t("undone")}` : ""}
            </span>
          </span>
          <button type="button" className="btn btn-sm" disabled={!e.undoable || e.undone} title={e.undoable ? "" : t("Too many pages to be kept.")} onClick={() => void revert(e)}>
            ↩ {t("Undo")}
          </button>
        </li>
      ))}
    </ul>
  );
}
