"use client";

import { useTransition } from "react";
import { addTodoNoteAction, instructTodoAction, suggestTodoActionsAction } from "@/app/actions";
import { NoteIcon, SparkIcon } from "../icons";
import { toast } from "../Toaster";
import { saveDraft, useTodoDrafts } from "./todo-drafts";

export type QuickPanel = "note" | "ai" | null;

const ICON_BTN =
  "inline-flex size-5 items-center justify-center rounded align-middle text-zinc-400 hover:bg-zinc-100 hover:text-indigo-600 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-indigo-400";

/** The todo's two small buttons: a note to it (context), an instruction for Copilot. */
export function TodoQuickButtons({ todoId, panel, onToggle, aiDisabled }: { todoId: number; panel: QuickPanel; onToggle: (p: QuickPanel) => void; aiDisabled?: string }) {
  const drafts = useTodoDrafts(todoId);
  const dot = <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-amber-500" aria-hidden />;
  return (
    <span className="ml-1 inline-flex items-center gap-0.5 align-middle">
      <button
        type="button"
        className={`${ICON_BTN} relative ${panel === "note" ? "bg-zinc-100 text-indigo-600 dark:bg-zinc-800 dark:text-indigo-400" : ""}`}
        title={drafts.note ? `Notiz-Entwurf: ${drafts.note.slice(0, 120)}` : "Notiz dazu — Kontext für die Ticket-Lage, Worker und Agenten"}
        aria-label="Notiz hinzufügen"
        aria-expanded={panel === "note"}
        onClick={() => onToggle(panel === "note" ? null : "note")}
      >
        <NoteIcon className="size-3.5" />
        {drafts.note && dot}
      </button>
      <button
        type="button"
        className={`${ICON_BTN} relative ${panel === "ai" ? "bg-zinc-100 text-indigo-600 dark:bg-zinc-800 dark:text-indigo-400" : ""}`}
        title={aiDisabled ?? (drafts.ai ? `Anweisungs-Entwurf: ${drafts.ai.slice(0, 120)}` : "Anweisung an Copilot — er arbeitet damit an diesem Todo (Work-Tab)")}
        aria-label="Anweisung an Copilot"
        aria-expanded={panel === "ai"}
        disabled={!!aiDisabled}
        onClick={() => onToggle(panel === "ai" ? null : "ai")}
      >
        <SparkIcon className="size-3.5" />
        {drafts.ai && dot}
      </button>
      {/* Not sent yet: said beside them (a click opens it). */}
      {!panel && (drafts.ai || drafts.note) && (
        <button type="button" className="ml-1 text-[11px] font-medium text-amber-700 hover:underline dark:text-amber-400" onClick={() => onToggle(drafts.ai ? "ai" : "note")} title={(drafts.ai || drafts.note).slice(0, 200)}>
          {drafts.ai ? "Anweisung" : "Notiz"} als Entwurf
        </button>
      )}
    </span>
  );
}

/** The text field the buttons open: a note saved to the todo, or an instruction Copilot carries out. */
export function TodoQuickPanel({ todoId, todoRef, panel, onClose }: { todoId: number; todoRef: string; panel: QuickPanel; onClose: () => void }) {
  const drafts = useTodoDrafts(todoId);
  const [pending, start] = useTransition();
  if (!panel) return null;
  const ai = panel === "ai";
  const text = drafts[panel];
  const setText = (v: string) => saveDraft(todoId, panel, v);
  const submit = () => {
    if (!text.trim() || pending) return;
    start(async () => {
      const r = ai ? await instructTodoAction(todoId, text) : await addTodoNoteAction(todoId, text);
      if (!r?.ok) {
        toast(r?.error ?? "Ging nicht.", { tone: "error" });
        return;
      }
      if (ai) toast(r.message ?? `Copilot arbeitet an ${todoRef}.`);
      saveDraft(todoId, panel, "");
      onClose();
    });
  };
  // What the AI can do with a todo, as one click (actions now) or a ready instruction to edit.
  const SHORTCUTS: { label: string; title: string; text?: string }[] = [
    { label: "Aktionen vorschlagen", title: "Die KI macht jetzt fertige Aktionen für dieses Todo (Nachricht, Kommentar, Mail, Termin …)" },
    { label: "Antwort entwerfen", title: "Anweisung: die Antwort/Nachricht entwerfen, um die es geht", text: `Entwirf die Antwort oder Nachricht, um die es in ${todoRef} geht — fertig formuliert, als followUp mit Entwurf (channel, target) und ggf. als Operation. Nichts senden.` },
    { label: "Zusammenfassen", title: "Anweisung: Stand und nächster Schritt", text: `Fass zusammen, worum es in ${todoRef} geht: was der Stand ist, wer was zuletzt gesagt hat, was offen ist und was der nächste Schritt wäre. Nichts ändern.` },
    { label: "Recherchieren", title: "Anweisung: im Repo und Kontext nachsehen und berichten", text: `Sieh im Repo und im Kontext nach, was für ${todoRef} wichtig ist (betroffene Stellen, Ursachen, offene Fragen), und berichte. Nichts ändern.` },
  ];
  return (
    <div className="mt-1.5 space-y-1.5 rounded-md border border-zinc-200 p-2 dark:border-zinc-700">
      {ai && (
        <span className="flex flex-wrap gap-1">
          {SHORTCUTS.map((sc) => (
            <button
              key={sc.label}
              type="button"
              className="rounded-full border border-violet-200 px-2 py-0.5 text-xs text-violet-700 hover:bg-violet-50 disabled:opacity-50 dark:border-violet-900 dark:text-violet-300 dark:hover:bg-violet-950"
              title={sc.title}
              disabled={pending}
              onClick={() =>
                sc.text
                  ? setText(sc.text)
                  : start(async () => {
                      const r = await suggestTodoActionsAction(todoId);
                      toast(r?.ok ? (r.message ?? "Erledigt.") : (r?.error ?? "Ging nicht."), { tone: r?.ok ? "ok" : "error" });
                      if (r?.ok) onClose();
                    })
              }
            >
              ✨ {sc.label}
            </button>
          ))}
        </span>
      )}
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
          {text.trim() && " · Entwurf gespeichert"}
        </span>
        <span className="flex gap-1.5">
          {text.trim() && (
            <button type="button" className="btn btn-sm" onClick={() => saveDraft(todoId, panel, "")} disabled={pending} title="Den Entwurf löschen">
              Verwerfen
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={onClose} disabled={pending} title="Schließen — der Entwurf bleibt">
            Schließen
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={submit} disabled={pending || !text.trim()}>
            {pending ? "…" : ai ? "An Copilot" : "Notiz speichern"}
          </button>
        </span>
      </div>
    </div>
  );
}
