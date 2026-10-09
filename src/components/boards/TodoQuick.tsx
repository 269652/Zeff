"use client";

import { useState, useTransition } from "react";
import { addTodoNoteAction, instructTodoAction } from "@/app/actions";
import { NoteIcon, SparkIcon } from "../icons";
import { toast } from "../Toaster";

export type QuickPanel = "note" | "ai" | null;

const ICON_BTN =
  "inline-flex size-5 items-center justify-center rounded align-middle text-zinc-400 hover:bg-zinc-100 hover:text-indigo-600 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-indigo-400";

/** The todo's two small buttons: a note to it (context), an instruction for Copilot. */
export function TodoQuickButtons({ panel, onToggle, aiDisabled }: { panel: QuickPanel; onToggle: (p: QuickPanel) => void; aiDisabled?: string }) {
  return (
    <span className="ml-1 inline-flex gap-0.5 align-middle">
      <button
        type="button"
        className={`${ICON_BTN} ${panel === "note" ? "bg-zinc-100 text-indigo-600 dark:bg-zinc-800 dark:text-indigo-400" : ""}`}
        title="Notiz dazu — Kontext für die Ticket-Lage, Worker und Agenten"
        aria-label="Notiz hinzufügen"
        aria-expanded={panel === "note"}
        onClick={() => onToggle(panel === "note" ? null : "note")}
      >
        <NoteIcon className="size-3.5" />
      </button>
      <button
        type="button"
        className={`${ICON_BTN} ${panel === "ai" ? "bg-zinc-100 text-indigo-600 dark:bg-zinc-800 dark:text-indigo-400" : ""}`}
        title={aiDisabled ?? "Anweisung an Copilot — er arbeitet damit an diesem Todo (Work-Tab)"}
        aria-label="Anweisung an Copilot"
        aria-expanded={panel === "ai"}
        disabled={!!aiDisabled}
        onClick={() => onToggle(panel === "ai" ? null : "ai")}
      >
        <SparkIcon className="size-3.5" />
      </button>
    </span>
  );
}

/** The text field the buttons open: a note saved to the todo, or an instruction Copilot carries out. */
export function TodoQuickPanel({ todoId, todoRef, panel, onClose }: { todoId: number; todoRef: string; panel: QuickPanel; onClose: () => void }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  if (!panel) return null;
  const ai = panel === "ai";
  const submit = () => {
    if (!text.trim() || pending) return;
    start(async () => {
      const r = ai ? await instructTodoAction(todoId, text) : await addTodoNoteAction(todoId, text);
      if (!r?.ok) {
        toast(r?.error ?? "Ging nicht.", { tone: "error" });
        return;
      }
      if (ai) toast(r.message ?? `Copilot arbeitet an ${todoRef}.`);
      setText("");
      onClose();
    });
  };
  return (
    <div className="mt-1.5 space-y-1.5 rounded-md border border-zinc-200 p-2 dark:border-zinc-700">
      <textarea
        autoFocus
        rows={ai ? 3 : 2}
        className="input w-full resize-y text-sm"
        placeholder={ai ? `Was soll Copilot zu ${todoRef} tun? (z. B. „Prüf, ob das auf dem Branch schon umgesetzt ist“)` : `Notiz zu ${todoRef} — was du weißt, was gilt, was schon geklärt ist …`}
        value={text}
        disabled={pending}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") onClose();
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-zinc-400">
          {ai ? "Copilot CLI bekommt das Todo mit allem Kontext; das Ergebnis steht im Work-Tab." : "Geht als Kontext an die Ticket-Lage, Worker und Agenten."} Strg+Enter
        </span>
        <span className="flex gap-1.5">
          <button type="button" className="btn btn-sm" onClick={onClose} disabled={pending}>
            Abbrechen
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={submit} disabled={pending || !text.trim()}>
            {pending ? "…" : ai ? "An Copilot" : "Notiz speichern"}
          </button>
        </span>
      </div>
    </div>
  );
}
