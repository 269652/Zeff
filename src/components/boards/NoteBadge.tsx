"use client";

import { useState, useTransition } from "react";
import { MentionTextarea } from "../MentionTextarea";
import { rich } from "@/lib/i18n/rich";
import { removeTodoNoteAction, syncNoteToJiraAction, updateTodoNoteAction } from "@/plugins/todos/server-actions";
import { noteSyncState, type TodoSource, type TodoUserNote } from "@/lib/boards/shared";
import { PeopleGroup, TaggedText, useTaggedPeople } from "@/plugins/people/PersonMention";
import { NoteIcon, PencilIcon, SparkIcon } from "../icons";
import { DismissButton } from "../DismissButton";
import { HoverCard } from "../HoverCard";
import { toast } from "../Toaster";
import { TodoRefs } from "./TodoRefs";
import { SourceCard } from "../SourceCard";
import { NOTE_IMAGE, noteImageIds } from "@/plugins/documents/shared";
import { NoteText } from "./NoteText";
import { formatDateTime } from "@/lib/format";
import { useT } from "@/components/I18nProvider";


/** Jira's mark: the entry is on Jira too. */
function JiraMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden>
      <path d="M17.6 9.4 10.9 2.7 10 1.8 4.6 7.2 2.4 9.4a.9.9 0 0 0 0 1.2l4.9 4.9L10 18.2l5.4-5.4.1-.1 2.1-2.2a.9.9 0 0 0 0-1.1ZM10 12.4 7.6 10 10 7.6l2.4 2.4-2.4 2.4Z" />
    </svg>
  );
}

/** A note on a todo as a small card, like a comment: a run's report (AI report) or yours; ↗ opens what it links to. */
export function NoteBadge({ n, className = "", jira }: { n: TodoUserNote; className?: string; /** The Jira comment this note became: one entry, with both icons. */ jira?: TodoSource }) {
  const t = useT();
  const onJira = jira?.source === "jira-comment" ? jira.comment : null;
  const ai = !!n.by;
  const plain = n.text.replace(NOTE_IMAGE, "").trim();
  const [first, ...more] = plain.split("\n");
  const who = n.by ?? (n.kind === "instruction" ? (n.run ? t("Your instruction → W-{run}", { run: n.run }) : t("Your instruction")) : t("Your note"));
  const imageId = noteImageIds(n.text)[0];
  return (
    <SourceCard
      tone={ai ? "indigo" : "zinc"}
      icon={ai || n.kind === "instruction" ? <SparkIcon /> : <NoteIcon />}
      kind={ai ? t("AI report") : t("Note")}
      mark={
        onJira || n.jiraCommentId ? (
          <span
            className="inline-flex shrink-0 items-center"
            title={onJira ? t("On both: your note here and its comment on Jira ({ticket}, {when})", { ticket: onJira.ticket, when: formatDateTime(onJira.at) }) : t("Also on Jira as a comment (it shows here once the Jira sync has read it back)")}
          >
            <JiraMark className="size-3.5 text-sky-600 dark:text-sky-400" />
          </span>
        ) : undefined
      }
      title={first.replace(/\s+/g, " ").trim() || who}
      sub={[who, n.from ? t("on T-{id}", { id: n.from }) : "", formatDateTime(n.at)].filter(Boolean).join(" · ")}
      snippet={more.join(" ").replace(/\s+/g, " ").trim() || undefined}
      thumb={imageId !== undefined ? `/api/documents/${imageId}/file` : undefined}
      href={n.url || undefined}
      hrefTitle={n.urlLabel ?? t("Open")}
      className={className}
    />
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
        · {formatDateTime(n.at)}
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
        <NoteText text={n.text} render={(s) => <TaggedText text={s} render={(x) => <TodoRefs text={x} />} />} />
      </p>
      {onJira && (
        <p className="flex items-center gap-1.5 text-xs text-sky-700 dark:text-sky-300">
          <JiraMark className="size-3.5 shrink-0" />
          {t("Your note and its comment on Jira — {ticket}, {when}, by {author}", { ticket: onJira.ticket, when: formatDateTime(onJira.at), author: onJira.author })}
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
  // The people the note tags: hovering a name opens the card's sidebar, a carousel of them all with that one in front.
  const tagged = useTaggedPeople(n.text);
  return (
    <span className="flex min-w-0 flex-col items-stretch gap-1">
      <PeopleGroup people={tagged}>
      <HoverCard className="group relative w-full flex-col items-stretch gap-1" card={<NoteDetails n={n} jira={jira} />}>
        <NoteBadge n={n} jira={jira} className="min-w-0 flex-1" />
        {/* The card's own actions sit on its corner, shown with the pointer or the focus on it (always on touch). */}
        {own && (
          <span className="absolute top-2 right-2 flex items-center gap-0.5 rounded-full bg-white/90 opacity-0 shadow-sm group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 dark:bg-zinc-900/90">
        {mine && (
          <button type="button" className="icon-btn shrink-0" title={t("Edit the text")} aria-label={t("Edit the text")} onClick={() => (setText(n.text), setEditing(true))}>
            <PencilIcon className="size-3.5" />
          </button>
        )}
        {/* In sync, the Jira mark on the badge says it; the button is for a note that isn't on Jira yet or has changed since. */}
        {mine && sync !== "synced" && (
          <button
            type="button"
            className={`w-fit shrink-0 rounded px-1 text-xs font-medium hover:underline disabled:opacity-40 ${sync === "changed" ? "text-amber-600 dark:text-amber-400" : "text-indigo-600 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 dark:text-indigo-400"}`}
            disabled={pending}
            title={
              sync === "changed"
                ? t("Changed since the last sync (the note, or who the people you tagged are) — sync again to update the comment on Jira")
                : t("Puts the note on the todo's Jira ticket as a comment — people you tagged (@) are mentioned there")
            }
            onClick={() =>
              start(async () => {
                const r = await syncNoteToJiraAction(todoId!, n.at);
                toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("Didn't work.")), { tone: r?.ok ? "ok" : "error" });
              })
            }
          >
            {pending ? "…" : sync === "changed" ? t("Sync again") : t("Sync to Jira")}
          </button>
        )}
        {own && <DismissButton className="opacity-100" onDismiss={() => removeTodoNoteAction(todoId!, n.at)} title={t("Dismiss — takes it out of this todo's context for good")} label={t("Dismiss this context item")} />}
          </span>
        )}
      </HoverCard>
      </PeopleGroup>
      {editing && (
        <span className="block w-full max-w-xl space-y-1.5">
          <MentionTextarea autoFocus images rows={4} className="input w-full resize-y text-sm" value={text} onChange={setText} disabled={pending} aria-label={t("Edit the text")} />
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
