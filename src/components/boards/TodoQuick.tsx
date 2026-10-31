"use client";

import { FormError } from "@/components/FormError";
import { useEffect, useRef, useState, useTransition } from "react";
import { addTodoNoteAction, draftReplyAction, instructTodoAction, openReplyTargetAction, paymentForTodoAction, suggestTodoActionsAction } from "@/plugins/todos/server-actions";
import type { TodoPayment } from "@/lib/girocode-todo";
import { GiroCode } from "../GiroCode";
import type { ReplyTarget } from "@/lib/todos/reply-draft";
import { MentionTextarea } from "../MentionTextarea";
import { TagSuggestions } from "@/plugins/people/TagSuggestions";
import { NoteIcon, SparkIcon } from "../icons";
import { toast } from "../Toaster";
import { useT } from "@/components/I18nProvider";
import type { T } from "@/lib/i18n/shared";
import { getDraft, saveDraft, useTodoDrafts } from "./todo-drafts";
import { AttachPanel } from "@/plugins/documents/AttachPanel";
import { uploadDocuments } from "@/plugins/documents/DocumentsApp";
import { attachDocumentAction, ensureDocumentsAction } from "@/plugins/documents/server-actions";
import { usePluginOn } from "../PluginFlags";
import { TodoTimePanel } from "./TodoTime";
import type { TimeRecord } from "@/lib/work/shared";

export type QuickPanel = "note" | "ai" | "reply" | "doc" | "time" | "pay" | null;

const ICON_BTN =
  "inline-flex size-5 items-center justify-center rounded align-middle text-zinc-400 hover:bg-zinc-100 hover:text-indigo-600 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-indigo-400";

/** The todo's small buttons: a document, time, a note to it (context), an instruction for Copilot, a reply — and paying it, when it names an amount or an IBAN. */
export function TodoQuickButtons({ todoId, panel, onToggle, aiDisabled, canReply, canPay }: { todoId: number; panel: QuickPanel; onToggle: (p: QuickPanel) => void; aiDisabled?: string; canReply?: boolean; canPay?: boolean }) {
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
        title={aiDisabled ?? (drafts.ai ? t("Instruction draft: {text}", { text: drafts.ai.slice(0, 120) }) : t("Instruction to Copilot — it works on this todo with it (Code tab)"))}
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
      {canPay && (
        <button
          type="button"
          className={`${ICON_BTN} ${panel === "pay" ? "bg-zinc-100 text-indigo-600 dark:bg-zinc-800 dark:text-indigo-400" : ""}`}
          title={t("Pay with GiroCode — scan it with your banking app")}
          aria-label={t("Pay with GiroCode")}
          aria-expanded={panel === "pay"}
          onClick={() => onToggle(panel === "pay" ? null : "pay")}
        >
          <svg viewBox="0 0 20 20" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="3" width="5" height="5" />
            <rect x="12" y="3" width="5" height="5" />
            <rect x="3" y="12" width="5" height="5" />
            <path d="M12 12h2v2h-2zM15 15h2v2h-2z" fill="currentColor" stroke="none" />
          </svg>
        </button>
      )}
      {/* Not sent yet: said beside them (a click opens it). */}
      {!panel && (drafts.ai || drafts.note) && (
        <button type="button" className="ml-1 text-xs font-medium text-amber-700 hover:underline dark:text-amber-400" onClick={() => onToggle(drafts.ai ? "ai" : "note")} title={(drafts.ai || drafts.note).slice(0, 200)}>
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
  const [uploading, setUploading] = useState(0);
  const [over, setOver] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  if (!panel) return null;
  if (panel === "reply") return <ReplyPanel todoId={todoId} onClose={onClose} />;
  if (panel === "doc") return <AttachPanel todoId={todoId} onClose={onClose} />;
  if (panel === "time") return <TodoTimePanel todoId={todoId} time={time} onClose={onClose} />;
  if (panel === "pay") return <PayPanel todoId={todoId} onClose={onClose} />;
  const ai = panel === "ai";
  const text = drafts[panel];
  const setText = (v: string) => saveDraft(todoId, panel, v);
  // (Pictures work without the Documents plugin being on: the first one installs it.)
  const imagesOn = !ai;
  // Pictures for the note (pasted, dropped, chosen): kept as documents (read by the Documents plugin: what they show, the text in
  // them), attached to the todo — so the AI that works on it or reviews it knows them — and named in the note.
  const takeImages = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;
    setUploading((n) => n + images.length);
    try {
      // (a pasted screenshot is called "image.png": a name of its own says more)
      const stamp = new Date().toISOString().slice(0, 19).replace("T", " ").replace(/:/g, "-");
      const named = images.map((f, i) => (/^image\.\w+$/i.test(f.name) ? new File([f], `Bild ${stamp}${images.length > 1 ? ` ${i + 1}` : ""}.${(f.type.split("/")[1] ?? "png").replace("jpeg", "jpg")}`, { type: f.type }) : f));
      const ready = await ensureDocumentsAction();
      if (!ready?.ok) return void toast(ready?.error ?? t("Didn't work."), { tone: "error" });
      if (ready.message) toast(ready.message, { tone: "ok" });
      const r = await uploadDocuments(named);
      if (!r.ok || !r.documents?.length) return void toast(r.error ?? r.errors?.join(" · ") ?? t("Didn't work."), { tone: "error" });
      // Each picture is kept as a document, attached to the todo, and referenced in the note as ![title](doc:12) — the same
      // reference the editor's autocomplete makes (typing ![title]( opens the search).
      const markers: string[] = [];
      for (const d of r.documents) {
        const a = await attachDocumentAction(todoId, d.id);
        if (a?.ok) markers.push(`![${d.name.replace(/\.[a-z0-9]+$/i, "").replace(/[[\]]/g, "")}](${d.ref})`);
        else toast(a?.error ?? t("Didn't work."), { tone: "error" });
      }
      if (markers.length) {
        const now = getDraft(todoId, "note");
        saveDraft(todoId, "note", `${now}${now && !now.endsWith("\n") ? "\n" : ""}${markers.join("\n")}`);
        toast(markers.length === 1 ? t("Image attached — the AI will know it.") : t("{n} images attached — the AI will know them.", { n: markers.length }), { tone: "ok" });
      }
    } finally {
      setUploading((n) => n - images.length);
    }
  };
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
    <div
      className={`mt-1.5 space-y-1.5 rounded-md border p-2 ${over ? "border-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/20" : "border-zinc-200 dark:border-zinc-700"}`}
      onPaste={(e) => {
        const files = imagesOn ? [...e.clipboardData.files].filter((f) => f.type.startsWith("image/")) : [];
        if (!files.length) return;
        e.preventDefault();
        void takeImages(files);
      }}
      onDragOver={(e) => {
        if (!imagesOn || ![...e.dataTransfer.types].includes("Files")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        if (!imagesOn) return;
        const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
        if (!files.length) return;
        e.preventDefault();
        void takeImages(files);
      }}
    >
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
        images={imagesOn}
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
      {!ai && <TagSuggestions todoId={todoId} text={text} onPick={(name) => setText(`${text}${text && !/\s$/.test(text) ? " " : ""}@${name} `)} />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-zinc-400">
          {ai ? t("Copilot CLI gets the todo with all its context; the result shows on the Code tab.") : t("Goes as context to the briefing, workers and agents.")} Ctrl+Enter
          {imagesOn && ` · ${t("paste or drop pictures here")}`}
          {uploading > 0 && ` · ${t("adding pictures …")}`}
          {text.trim() && ` · ${t("draft saved")}`}
        </span>
        <span className="flex gap-1.5">
          {imagesOn && (
            <>
              <input ref={imageInput} type="file" accept="image/*" multiple hidden aria-hidden tabIndex={-1} onChange={(e) => { void takeImages([...(e.target.files ?? [])]); e.target.value = ""; }} />
              <button type="button" className="btn btn-sm" onClick={() => imageInput.current?.click()} disabled={pending || uploading > 0} title={t("Add a picture (a screenshot, a mock-up): it is attached to the todo and the AI gets it as an attachment")}>
                🖼 {t("Picture")}
              </button>
            </>
          )}
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
          aria-label={t("Reply")}
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

/** "Pay with GiroCode": the account the todo's payment goes to (its text, your notes, a person it names, its knowledge), as a code to scan. */
function PayPanel({ todoId, onClose }: { todoId: number; onClose: () => void }) {
  const t = useT();
  const [payment, setPayment] = useState<TodoPayment | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    paymentForTodoAction(todoId).then(
      (p) => live && setPayment(p),
      () => live && setPayment(null),
    );
    return () => {
      live = false;
    };
  }, [todoId]);
  return (
    <div className="mt-1.5 space-y-2 rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
      <div className="flex items-baseline justify-between gap-2 text-xs font-semibold text-zinc-500">
        <span>{payment?.via ? t("Pay with GiroCode — the account of {name}", { name: payment.via }) : t("Pay with GiroCode")}</span>
        <button type="button" className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" aria-label={t("Close")} onClick={onClose}>
          ×
        </button>
      </div>
      {payment === undefined ? (
        <p className="text-xs text-zinc-500">{t("Looking for the account…")}</p>
      ) : payment ? (
        <GiroCode {...payment} />
      ) : (
        <p className="text-xs text-zinc-500">{t("No account to pay found — an IBAN in the todo or a note, or the bank account of a person it names (People).")}</p>
      )}
    </div>
  );
}
