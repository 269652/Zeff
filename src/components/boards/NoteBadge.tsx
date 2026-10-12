"use client";

import { useState, useTransition } from "react";
import { MentionTextarea } from "../MentionTextarea";
import { rich } from "@/lib/i18n/rich";
import { removeTodoNoteAction, syncNoteToJiraAction, updateTodoNoteAction } from "@/plugins/todos/server-actions";
import type { TodoUserNote } from "@/lib/boards/shared";
import { NoteIcon, PencilIcon, SparkIcon } from "../icons";
import { DismissButton } from "../DismissButton";
import { HoverCard } from "../HoverCard";
import { toast } from "../Toaster";
import { TodoRefs } from "./TodoRefs";
import { formatDateTime } from "@/lib/format";
import { useT } from "@/components/I18nProvider";

const when = (iso: string) => formatDateTime(iso);

/** A note on a todo as a badge, like a comment: a run's report (✨, violet) or yours (💬); ↗ opens what it links to. */
export function NoteBadge({ n, className = "" }: { n: TodoUserNote; className?: string }) {
  const t = useT();
  const ai = !!n.by;
  const tone = ai
    ? "border-violet-200 bg-violet-50 text-violet-950 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-100"
    : "border-indigo-200 bg-indigo-50 text-indigo-950 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-100";
  return (
    <div className={`flex min-w-0 items-stretch overflow-hidden rounded-md border text-xs ${tone} ${className}`}>
      <span className="flex min-w-0 flex-1 items-center gap-2 py-1 pr-2 pl-1.5">
        {ai || n.kind === "instruction" ? <SparkIcon className={`size-4 shrink-0 ${ai ? "text-violet-600 dark:text-violet-400" : "text-indigo-600 dark:text-indigo-400"}`} /> : <NoteIcon className="size-4 shrink-0 text-indigo-600 dark:text-indigo-400" />}
        <span className="shrink-0 font-medium">{n.by ??
            (n.kind === "instruction"
              ? n.run
                ? t("Your instruction → W-{run}", { run: n.run })
                : t("Your instruction")
              : t("Your note"))}</span>
        {n.from && <span className="shrink-0 font-mono opacity-70">{t("on T-{id}", { id: n.from })}</span>}
        <span className="shrink-0 opacity-70">{when(n.at)}</span>
        <span className="min-w-0 truncate opacity-80">
          <TodoRefs text={n.text.replace(/\s+/g, " ")} />
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
export function NoteDetails({ n }: { n: TodoUserNote; todoId?: number }) {
  const t = useT();
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
        {n.jiraCommentId && <span className="text-emerald-600 dark:text-emerald-400"> · {t("✓ on Jira")}</span>}
      </div>
      <p className="leading-relaxed whitespace-pre-line text-zinc-700 dark:text-zinc-300">
        <TodoRefs text={n.text} />
      </p>
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
export function NoteRow({ n, todoId }: { n: TodoUserNote; todoId?: number }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(n.text);
  const own = todoId !== undefined && !n.from;
  const mine = own && !n.by && n.kind !== "instruction";
  return (
    <span className="flex flex-col items-start gap-1">
      <HoverCard className="group gap-1.5 sm:max-w-md" card={<NoteDetails n={n} />}>
        <NoteBadge n={n} className="min-w-0" />
        {mine && (
          <button type="button" className="icon-btn shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" title={t("Edit the text")} aria-label={t("Edit the text")} onClick={() => (setText(n.text), setEditing(true))}>
            <PencilIcon className="size-3.5" />
          </button>
        )}
        {mine && (
          <button
            type="button"
            className={`shrink-0 rounded px-1 text-xs font-medium hover:underline disabled:opacity-40 ${n.jiraCommentId ? "text-emerald-600 dark:text-emerald-400" : "text-indigo-600 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 dark:text-indigo-400"}`}
            disabled={pending}
            title={n.jiraCommentId ? t("Updates the comment on the ticket in Jira if the note changed — people you tagged (@) are mentioned there") : t("Puts the note on the todo's Jira ticket as a comment — people you tagged (@) are mentioned there")}
            onClick={() =>
              start(async () => {
                const r = await syncNoteToJiraAction(todoId!, n.at);
                toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("Didn't work.")), { tone: r?.ok ? "ok" : "error" });
              })
            }
          >
            {pending ? "…" : n.jiraCommentId ? t("✓ on Jira") : t("Sync to Jira")}
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
