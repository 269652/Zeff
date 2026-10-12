"use client";

import { useState, useTransition } from "react";
import { MentionTextarea } from "../MentionTextarea";
import { rich } from "@/lib/i18n/rich";
import { removeTodoNoteAction, syncNoteToJiraAction, updateTodoNoteAction } from "@/plugins/todos/server-actions";
import { noteSyncState, type TodoSource, type TodoUserNote } from "@/lib/boards/shared";
import { TaggedText } from "@/plugins/people/PersonMention";
import { NoteIcon, PencilIcon, SparkIcon } from "../icons";
import { DismissButton } from "../DismissButton";
import { HoverCard } from "../HoverCard";
import { toast } from "../Toaster";
import { TodoRefs } from "./TodoRefs";
import { formatDateTime } from "@/lib/format";
import { useT } from "@/components/I18nProvider";

const when = (iso: string) => formatDateTime(iso);

/** Jira's mark: the entry is on Jira too. */
function JiraMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden>
      <path d="M17.6 9.4 10.9 2.7 10 1.8 4.6 7.2 2.4 9.4a.9.9 0 0 0 0 1.2l4.9 4.9L10 18.2l5.4-5.4.1-.1 2.1-2.2a.9.9 0 0 0 0-1.1ZM10 12.4 7.6 10 10 7.6l2.4 2.4-2.4 2.4Z" />
    </svg>
  );
}

/** A note on a todo as a badge, like a comment: a run's report (✨, violet) or yours (💬); ↗ opens what it links to. */
export function NoteBadge({ n, className = "", jira }: { n: TodoUserNote; className?: string; /** The Jira comment this note became: one entry, with both icons. */ jira?: TodoSource }) {
  const t = useT();
  const onJira = jira?.source === "jira-comment" ? jira.comment : null;
  const ai = !!n.by;
  const tone = ai
    ? "border-violet-200 bg-violet-50 text-violet-950 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-100"
    : "border-indigo-200 bg-indigo-50 text-indigo-950 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-100";
  return (
    <div className={`flex min-w-0 items-stretch overflow-hidden rounded-md border text-xs ${tone} ${className}`}>
      <span className="flex min-w-0 flex-1 items-center gap-2 py-1 pr-2 pl-1.5">
        {ai || n.kind === "instruction" ? <SparkIcon className={`size-4 shrink-0 ${ai ? "text-violet-600 dark:text-violet-400" : "text-indigo-600 dark:text-indigo-400"}`} /> : <NoteIcon className="size-4 shrink-0 text-indigo-600 dark:text-indigo-400" />}
        {onJira && (
          <span className="inline-flex shrink-0 items-center" title={t("On both: your note here and its comment on Jira ({ticket}, {when})", { ticket: onJira.ticket, when: when(onJira.at) })}>
            <JiraMark className="size-4 text-sky-600 dark:text-sky-400" />
          </span>
        )}
        <span className="shrink-0 font-medium">{n.by ??
            (n.kind === "instruction"
              ? n.run
                ? t("Your instruction → W-{run}", { run: n.run })
                : t("Your instruction")
              : t("Your note"))}</span>
        {n.from && <span className="shrink-0 font-mono opacity-70">{t("on T-{id}", { id: n.from })}</span>}
        <span className="shrink-0 opacity-70">{when(n.at)}</span>
        <span className="min-w-0 truncate opacity-80">
          <TaggedText text={n.text.replace(/\s+/g, " ")} render={(s) => <TodoRefs text={s} />} />
        </span>
      </span>
      {n.url && (
        <a href={n.url} target="_blank" rel="noreferrer" className="flex shrink-0 items-center px-2 hover:bg-violet-100 dark:hover:bg-violet-950" title={n.urlLabel ?? t("Open")} aria-label={t("Open")}>
          ↗
        </a>
      )}
    </div>
  );
}

/** A note in full, as a card: what it says, who and when, where it links. (Changing, syncing and dismissing it are the buttons beside its badge.) */
export function NoteDetails({ n, jira }: { n: TodoUserNote; todoId?: number; jira?: TodoSource }) {
  const t = useT();
  const onJira = jira?.source === "jira-comment" ? jira.comment : null;
  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs text-zinc-500">
        {n.by
          ? t("Report by {by}", { by: n.by })
          : n.kind === "instruction"
            ? n.run
              ? t("Your instruction to W-{run}", { run: n.run })
              : t("Your instruction")
            : t("Your note")}{" "}
        · {when(n.at)}
        {n.from && (
          <>
            {" · "}
            {rich(t("on <ref>T-{id}</ref>", { id: n.from }), { ref: (s) => <TodoRefs text={s} /> })}
          </>
        )}
        {noteSyncState(n) === "synced" && <span className="text-emerald-600 dark:text-emerald-400"> · {t("✓ on Jira")}</span>}
        {noteSyncState(n) === "changed" && <span className="text-amber-600 dark:text-amber-400"> · {t("changed since the last sync to Jira")}</span>}
      </div>
      <p className="leading-relaxed whitespace-pre-line text-zinc-700 dark:text-zinc-300">
        <TaggedText text={n.text} render={(s) => <TodoRefs text={s} />} />
      </p>
      {onJira && (
        <p className="flex items-center gap-1.5 text-xs text-sky-700 dark:text-sky-300">
          <JiraMark className="size-3.5 shrink-0" />
          {t("Your note and its comment on Jira — {ticket}, {when}, by {author}", { ticket: onJira.ticket, when: when(onJira.at), author: onJira.author })}
        </p>
      )}
      {n.url && (
        <a href={n.url} target="_blank" rel="noreferrer" className="block font-mono text-xs text-indigo-600 hover:underline dark:text-indigo-400">
          {n.urlLabel ?? n.url} ↗
        </a>
      )}
    </div>
  );
}

/**
 * A note in a todo's context: its badge (hover for all of it) and beside it what you can do — your own
 * note can be changed (✎, in place) and put on its Jira ticket (⇄ Jira); any can be dismissed (×, as
 * everywhere). A note shown from another todo (`from`) is only shown.
 */
export function NoteRow({ n, todoId, jira }: { n: TodoUserNote; todoId?: number; jira?: TodoSource }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(n.text);
  const own = todoId !== undefined && !n.from;
  const mine = own && !n.by && n.kind !== "instruction";
  const sync = noteSyncState(n);
  return (
    <span className="flex flex-col items-start gap-1">
      <HoverCard className="group gap-1.5 sm:max-w-md" card={<NoteDetails n={n} jira={jira} />}>
        <NoteBadge n={n} jira={jira} className="min-w-0" />
        {mine && (
          <button type="button" className="icon-btn shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" title={t("Edit the text")} aria-label={t("Edit the text")} onClick={() => (setText(n.text), setEditing(true))}>
            <PencilIcon className="size-3.5" />
          </button>
        )}
        {mine && (
          <button
            type="button"
            className={`shrink-0 rounded px-1 text-xs font-medium hover:underline disabled:opacity-40 ${sync === "synced" ? "text-emerald-600 dark:text-emerald-400" : sync === "changed" ? "text-amber-600 dark:text-amber-400" : "text-indigo-600 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 dark:text-indigo-400"}`}
            disabled={pending}
            title={
              sync === "changed"
                ? t("The note has changed since the last sync — sync again to update the comment on Jira")
                : sync === "synced"
                  ? t("Matches the comment on Jira. Syncing again writes the comment again (it repairs it if it was changed there)")
                  : t("Puts the note on the todo's Jira ticket as a comment — people you tagged (@) are mentioned there")
            }
            onClick={() =>
              start(async () => {
                const r = await syncNoteToJiraAction(todoId!, n.at);
                toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("Didn't work.")), { tone: r?.ok ? "ok" : "error" });
              })
            }
          >
            {pending ? "…" : sync === "synced" ? t("✓ on Jira") : sync === "changed" ? t("Sync again") : t("Sync to Jira")}
          </button>
        )}
        {own && <DismissButton onDismiss={() => removeTodoNoteAction(todoId!, n.at)} title={t("Dismiss — takes it out of this todo's context for good")} label={t("Dismiss this context item")} />}
      </HoverCard>
      {editing && (
        <span className="block w-full max-w-xl space-y-1.5">
          <MentionTextarea autoFocus rows={4} className="input w-full resize-y text-sm" value={text} onChange={setText} disabled={pending} aria-label={t("Edit the text")} />
          <span className="flex gap-1.5">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={pending || !text.trim()}
              onClick={() =>
                start(async () => {
                  const r = await updateTodoNoteAction(todoId!, n.at, text);
                  if (r?.ok) setEditing(false);
                  else toast(r?.error ?? t("Didn't work."), { tone: "error" });
                })
              }
            >
              {pending ? "…" : t("Save")}
            </button>
            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => setEditing(false)}>
              {t("Cancel")}
            </button>
          </span>
        </span>
      )}
    </span>
  );
}
