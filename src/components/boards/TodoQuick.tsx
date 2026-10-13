"use client";

import { FormError } from "@/components/FormError";
import { useEffect, useRef, useState, useTransition } from "react";
import { addTodoNoteAction, draftReplyAction, instructTodoAction, openReplyTargetAction, suggestTodoActionsAction } from "@/plugins/todos/server-actions";
import type { ReplyTarget } from "@/lib/boards/reply-draft";
import { MentionTextarea } from "../MentionTextarea";
import { NoteIcon, SparkIcon } from "../icons";
import { toast } from "../Toaster";
import { useT } from "@/components/I18nProvider";
import type { T } from "@/lib/i18n/shared";
import { saveDraft, useTodoDrafts } from "./todo-drafts";
import { AttachPanel } from "@/plugins/documents/AttachPanel";
import { usePluginOn } from "../PluginFlags";
import { TodoTimePanel } from "./TodoTime";
import type { TimeRecord } from "@/lib/work/shared";

export type QuickPanel = "note" | "ai" | "reply" | "doc" | "time" | null;

const ICON_BTN =
  "inline-flex size-5 items-center justify-center rounded align-middle text-zinc-400 hover:bg-zinc-100 hover:text-indigo-600 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-indigo-400";

/** The todo's two small buttons: a note to it (context), an instruction for Copilot. */
export function TodoQuickButtons({ todoId, panel, onToggle, aiDisabled, canReply }: { todoId: number; panel: QuickPanel; onToggle: (p: QuickPanel) => void; aiDisabled?: string; canReply?: boolean }) {
  const t = useT();
  const drafts = useTodoDrafts(todoId);
  const dot = <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-amber-500" aria-hidden />;
  const documents = usePluginOn("documents");
  return (
    <span className="ml-1 inline-flex items-center gap-0.5 align-middle">
      {documents && (
        <button
          type="button"
          className={`${ICON_BTN} ${panel === "doc" ? "bg-zinc-100 text-indigo-600 dark:bg-zinc-800 dark:text-indigo-400" : ""}`}
          title={t("Attach a document — context for this todo")}
          aria-label={t("Attach a document")}
          aria-expanded={panel === "doc"}
          onClick={() => onToggle(panel === "doc" ? null : "doc")}
        >
          <svg viewBox="0 0 20 20" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15.5 9.5 9.2 15.8a3.5 3.5 0 0 1-5-5l6.6-6.6a2.3 2.3 0 0 1 3.3 3.3l-6.6 6.6a1.1 1.1 0 0 1-1.6-1.6l6-6" />
          </svg>
        </button>
      )}
      <button
        type="button"
        className={`${ICON_BTN} ${panel === "time" ? "bg-zinc-100 text-indigo-600 dark:bg-zinc-800 dark:text-indigo-400" : ""}`}
        title={t("Add time you spent on this todo")}
        aria-label={t("Add time")}
        aria-expanded={panel === "time"}
        onClick={() => onToggle(panel === "time" ? null : "time")}
      >
        <svg viewBox="0 0 20 20" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="10" cy="10" r="7" />
          <path d="M10 6v4l2.5 2" />
        </svg>
      </button>
      <button
        type="button"
        className={`${ICON_BTN} relative ${panel === "note" ? "bg-zinc-100 text-indigo-600 dark:bg-zinc-800 dark:text-indigo-400" : ""}`}
        title={drafts.note ? t("Note draft: {text}", { text: drafts.note.slice(0, 120) }) : t("Add a note — context for the briefing, workers and agents")}
        aria-label={t("Add a note")}
        aria-expanded={panel === "note"}
        onClick={() => onToggle(panel === "note" ? null : "note")}
      >
        <NoteIcon className="size-3.5" />
        {drafts.note && dot}
      </button>
      <button
        type="button"
        className={`${ICON_BTN} relative ${panel === "ai" ? "bg-zinc-100 text-indigo-600 dark:bg-zinc-800 dark:text-indigo-400" : ""}`}
        title={aiDisabled ?? (drafts.ai ? t("Instruction draft: {text}", { text: drafts.ai.slice(0, 120) }) : t("Instruction to Copilot — it works on this todo with it (Work tab)"))}
        aria-label={t("Instruction to Copilot")}
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
          title={drafts.reply ? t("Reply draft: {text}", { text: drafts.reply.slice(0, 120) }) : t("Draft a reply — the AI writes it from the history, you send it")}
          aria-label={t("Draft a reply")}
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
          {drafts.ai ? t("Instruction draft") : t("Note draft")}
        </button>
      )}
    </span>
  );
}

/** The text field the buttons open: a note saved to the todo, or an instruction Copilot carries out. */
export function TodoQuickPanel({ todoId, todoRef, panel, onClose, time }: { todoId: number; todoRef: string; panel: QuickPanel; onClose: () => void; time?: TimeRecord[] }) {
  const t = useT();
  const drafts = useTodoDrafts(todoId);
  const [pending, start] = useTransition();
  if (!panel) return null;
  if (panel === "reply") return <ReplyPanel todoId={todoId} onClose={onClose} />;
  if (panel === "doc") return <AttachPanel todoId={todoId} onClose={onClose} />;
  if (panel === "time") return <TodoTimePanel todoId={todoId} time={time} onClose={onClose} />;
  const ai = panel === "ai";
  const text = drafts[panel];
  const setText = (v: string) => saveDraft(todoId, panel, v);
  const submit = () => {
    if (!text.trim() || pending) return;
    start(async () => {
      const r = ai ? await instructTodoAction(todoId, text) : await addTodoNoteAction(todoId, text);
      if (!r?.ok) {
        toast(r?.error ?? t("Didn't work."), { tone: "error" });
        return;
      }
      if (ai) toast(r.message ?? t("Copilot is working on {ref}.", { ref: todoRef }));
      saveDraft(todoId, panel, "");
      onClose();
    });
  };
  // What the AI can do with a todo, as one click (actions now) or a ready instruction to edit.
  const SHORTCUTS: { label: string; title: string; text?: string }[] = [
    { label: t("Suggest actions"), title: t("The AI now makes ready-made actions for this todo (message, comment, mail, meeting…)") },
    { label: t("Draft a reply"), title: t("Instruction: draft the reply or message it is about"), text: `Entwirf die Antwort oder Nachricht, um die es in ${todoRef} geht — fertig formuliert, als followUp mit Entwurf (channel, target) und ggf. als Operation. Nichts senden.` },
    { label: t("Summarize"), title: t("Instruction: where it stands and the next step"), text: `Fass zusammen, worum es in ${todoRef} geht: was der Stand ist, wer was zuletzt gesagt hat, was offen ist und was der nächste Schritt wäre. Nichts ändern.` },
    { label: t("Research"), title: t("Instruction: look in the repo and the context and report"), text: `Sieh im Repo und im Kontext nach, was für ${todoRef} wichtig ist (betroffene Stellen, Ursachen, offene Fragen), und berichte. Nichts ändern.` },
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
                      toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("Didn't work.")), { tone: r?.ok ? "ok" : "error" });
                      if (r?.ok) onClose();
                    })
              }
            >
              ✨ {sc.label}
            </button>
          ))}
        </span>
      )}
      <MentionTextarea
        autoFocus
        rows={ai ? 3 : 2}
        className="input w-full resize-y text-sm"
        placeholder={ai ? t("What should Copilot do on {ref}? (e.g. “Check whether this is already done on the branch”)", { ref: todoRef }) : t("Note on {ref} — what you know, what applies, what's already settled… (@ tags people)", { ref: todoRef })}
        value={text}
        disabled={pending}
        onChange={setText}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") onClose();
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-zinc-400">
          {ai ? t("Copilot CLI gets the todo with all its context; the result shows on the Work tab.") : t("Goes as context to the briefing, workers and agents.")} Ctrl+Enter
          {text.trim() && ` · ${t("draft saved")}`}
        </span>
        <span className="flex gap-1.5">
          {text.trim() && (
            <button type="button" className="btn btn-sm" onClick={() => saveDraft(todoId, panel, "")} disabled={pending} title={t("Delete the draft")}>
              {t("Discard")}
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={onClose} disabled={pending} title={t("Close — the draft stays")}>
            {t("Close")}
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={submit} disabled={pending || !text.trim()}>
            {pending ? "…" : ai ? t("To Copilot") : t("Save note")}
          </button>
        </span>
      </div>
    </div>
  );
}

const channelLabels = (t: T): Record<ReplyTarget["channel"], string> => ({ whatsapp: "WhatsApp", signal: "Signal", mail: t("Mail"), teams: "Teams" });

/**
 * A reply to the message the todo is about: drafted by the AI from the conversation (when there's
 * no draft yet, at once), editable, kept as a draft in this browser — copied and sent by you
 * (WhatsApp, Gmail, Outlook or Teams brought up in the automation Chrome, Signal Desktop).
 */
function ReplyPanel({ todoId, onClose }: { todoId: number; onClose: () => void }) {
  const t = useT();
  const CHANNEL_LABELS = channelLabels(t);
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
      {pending && !text && <p className="text-sm text-zinc-500">{t("The AI is drafting the reply from the history…")}</p>}
      {error && <FormError as="p">{error}</FormError>}
      {(text || !pending) && (
        <textarea
          rows={Math.min(10, Math.max(3, text.split("\n").length + 1))}
          className="input w-full resize-y text-sm"
          placeholder={t("The reply…")}
          value={text}
          disabled={pending}
          onChange={(e) => saveDraft(todoId, "reply", e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-zinc-400">{target ? t("To {to} · {channel}", { to: target.to, channel: CHANNEL_LABELS[target.channel] }) : t("Nothing is sent — you copy it and send it.")}</span>
        <span className="flex flex-wrap gap-1.5">
          <button type="button" className="btn btn-sm" onClick={draft} disabled={pending} title={t("Draft again (the current text is replaced)")}>
            {pending ? "…" : t("Redraft")}
          </button>
          {/* Signal has no web page to bring up: you send from Signal Desktop. */}
          {target?.openUrl && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await openReplyTargetAction(target.openUrl);
                  toast(r?.ok ? (r.message ?? t("Opened.")) : (r?.error ?? t("Didn't work.")), { tone: r?.ok ? "ok" : "error" });
                })
              }
              title={t("Bring {channel} to the front in the automation Chrome", { channel: CHANNEL_LABELS[target.channel] })}
            >
              {t("Open {channel}", { channel: CHANNEL_LABELS[target.channel] })}
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!text.trim()}
            onClick={() =>
              navigator.clipboard.writeText(text).then(
                () => toast(t("Copied — paste it and send it.")),
                () => toast(t("Copying didn't work."), { tone: "error" }),
              )
            }
          >
            {t("Copy")}
          </button>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            {t("Close")}
          </button>
        </span>
      </div>
    </div>
  );
}
