"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { addTodoNoteAction, draftReplyAction, instructTodoAction, openReplyTargetAction, suggestTodoActionsAction } from "@/app/actions";
import type { ReplyTarget } from "@/lib/boards/reply-draft";
import { NoteIcon, SparkIcon } from "../icons";
import { toast } from "../Toaster";
import { saveDraft, useTodoDrafts } from "./todo-drafts";

export type QuickPanel = "note" | "ai" | "reply" | null;

const ICON_BTN =
  "inline-flex size-5 items-center justify-center rounded align-middle text-zinc-400 hover:bg-zinc-100 hover:text-indigo-600 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-indigo-400";

/** The todo's two small buttons: a note to it (context), an instruction for Copilot. */
export function TodoQuickButtons({ todoId, panel, onToggle, aiDisabled, canReply }: { todoId: number; panel: QuickPanel; onToggle: (p: QuickPanel) => void; aiDisabled?: string; canReply?: boolean }) {
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
      {canReply && (
        <button
          type="button"
          className={`${ICON_BTN} relative ${panel === "reply" ? "bg-zinc-100 text-indigo-600 dark:bg-zinc-800 dark:text-indigo-400" : ""}`}
          title={drafts.reply ? `Antwort-Entwurf: ${drafts.reply.slice(0, 120)}` : "Antwort entwerfen — die KI schreibt sie aus dem Verlauf, du schickst sie ab"}
          aria-label="Antwort entwerfen"
          aria-expanded={panel === "reply"}
          onClick={() => onToggle(panel === "reply" ? null : "reply")}
        >
          <svg viewBox="0 0 20 20" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M8 5 3 10l5 5" />
            <path d="M3 10h8a6 6 0 0 1 6 6v1" />
          </svg>
          {drafts.reply && dot}
        </button>
      )}
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
  if (panel === "reply") return <ReplyPanel todoId={todoId} onClose={onClose} />;
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

const CHANNEL_LABELS: Record<ReplyTarget["channel"], string> = { whatsapp: "WhatsApp", mail: "Mail", teams: "Teams" };

/**
 * A reply to the message the todo is about: drafted by the AI from the conversation (when there's
 * no draft yet, at once), editable, kept as a draft in this browser — copied and sent by you
 * (WhatsApp, Gmail, Outlook or Teams brought up in the automation Chrome).
 */
function ReplyPanel({ todoId, onClose }: { todoId: number; onClose: () => void }) {
  const drafts = useTodoDrafts(todoId);
  const [target, setTarget] = useState<ReplyTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const draft = () =>
    start(async () => {
      setError(null);
      const r = await draftReplyAction(todoId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      saveDraft(todoId, "reply", r.text);
      setTarget(r.target);
    });
  // Opened without a draft: one is written right away.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || drafts.reply) return;
    started.current = true;
    draft();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when opened
  }, []);
  const text = drafts.reply;
  return (
    <div className="mt-1.5 space-y-1.5 rounded-md border border-zinc-200 p-2 dark:border-zinc-700">
      {pending && !text && <p className="text-sm text-zinc-500">Die KI entwirft die Antwort aus dem Verlauf …</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {(text || !pending) && (
        <textarea
          rows={Math.min(10, Math.max(3, text.split("\n").length + 1))}
          className="input w-full resize-y text-sm"
          placeholder="Die Antwort …"
          value={text}
          disabled={pending}
          onChange={(e) => saveDraft(todoId, "reply", e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-zinc-400">{target ? `An ${target.to} · ${CHANNEL_LABELS[target.channel]}` : "Nichts wird gesendet — du kopierst und schickst ab."}</span>
        <span className="flex flex-wrap gap-1.5">
          <button type="button" className="btn btn-sm" onClick={draft} disabled={pending} title="Noch einmal entwerfen (der jetzige Text wird ersetzt)">
            {pending ? "…" : "Neu entwerfen"}
          </button>
          {target && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await openReplyTargetAction(target.openUrl);
                  toast(r?.ok ? (r.message ?? "Geöffnet.") : (r?.error ?? "Ging nicht."), { tone: r?.ok ? "ok" : "error" });
                })
              }
              title={`${CHANNEL_LABELS[target.channel]} im Automations-Chrome nach vorne holen`}
            >
              {CHANNEL_LABELS[target.channel]} öffnen
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!text.trim()}
            onClick={() =>
              navigator.clipboard.writeText(text).then(
                () => toast("Kopiert — einfügen und abschicken."),
                () => toast("Kopieren ging nicht.", { tone: "error" }),
              )
            }
          >
            Kopieren
          </button>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Schließen
          </button>
        </span>
      </div>
    </div>
  );
}
