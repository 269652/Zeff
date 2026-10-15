"use client";

import { actionHref } from "@/plugins/actions/catalog";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { doneBrowserOpAction, removeTodoOpAction, saveTodoOpTextAction } from "@/plugins/todos/server-actions";
import { opNote, type TodoView } from "@/lib/boards/shared";
import { OP_CHIP } from "./TodoAlternatives";
import { toast } from "../Toaster";
import { CheckIcon, CloseIcon, PencilIcon } from "../icons";
import { useT } from "@/components/I18nProvider";

/** A todo's operations (what "Run" runs), as notes. */
export function OpChips({
  ops,
  className = "mt-1 items-start",
  todoId,
  notes = {},
  indices,
}: {
  ops: TodoView["ops"];
  /** Where `ops` sit on the todo (when they're only some of its operations) — what editing or removing one refers to. */
  indices?: number[];
  className?: string;
  /** Given: the texts (comment, reply, Teams message) can be edited here before they're sent. */
  todoId?: number;
  /** The GitLab comments the operations are about, as links (by "note:123"). */
  notes?: NonNullable<TodoView["links"]>["notes"];
}) {
  return (
    <span className={`flex flex-col gap-1 ${className}`}>
      {ops.map((o, i) => (
        <OpChip key={i} op={o} index={indices?.[i] ?? i} todoId={todoId} note={"note" in o ? notes[o.note] : undefined} />
      ))}
    </span>
  );
}

/** One operation: its label and, for one with a text, the text — editable (a draft until it's sent). */
function OpChip({
  op,
  index,
  todoId,
  note,
}: {
  op: TodoView["ops"][number];
  index: number;
  todoId?: number;
  /** The GitLab comment it's about, as synced. */
  note?: NonNullable<TodoView["links"]>["notes"][string];
}) {
  const t = useT();
  const router = useRouter();
  const { heading, detail, body, files } = opNote(op, t);
  const href = actionHref(op);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(body ?? "");
  const [pending, start] = useTransition();
  return (
    <span className={`${OP_CHIP} max-w-full`}>
      <span className="flex items-start gap-1.5">
        <span className="min-w-0 flex-1">⚡ {heading}</span>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded px-1.5 font-medium text-sky-700 hover:bg-sky-100 dark:text-sky-300 dark:hover:bg-sky-900"
            title={t("Opens filled in in {app} — check it and send it yourself", { app: openIn(href) })}
          >
            {t("Open in {app}", { app: openIn(href) })} ↗
          </a>
        )}
        <span className="flex shrink-0 items-center gap-0.5">
        {body !== null && todoId !== undefined && !editing && (
          <button
            type="button"
            className="shrink-0 rounded px-1 text-sky-700 hover:bg-sky-100 dark:text-sky-300 dark:hover:bg-sky-900"
            onClick={() => {
              setText(body);
              setEditing(true);
            }}
            title={t("Edit the text")}
            aria-label={t("Edit the text")}
          >
            <PencilIcon className="size-3.5" />
          </button>
        )}
        {/* Done in Outlook (saved, sent): Zeff can't see it — you say so (✓), and it's noted on the todo. */}
        {href && todoId !== undefined && (
          <button
            type="button"
            className="shrink-0 rounded px-1 text-sky-700 hover:bg-sky-100 hover:text-emerald-700 disabled:opacity-50 dark:text-sky-300 dark:hover:bg-sky-900 dark:hover:text-emerald-400"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await doneBrowserOpAction(todoId, index);
                toast(r?.ok ? (r.message ?? t("Noted.")) : (r?.error ?? t("Didn't work.")), { tone: r?.ok ? "ok" : "error" });
                router.refresh();
              })
            }
            title={op.type === "calendar-event" ? t("Done: the meeting is created in Outlook — note it on the todo") : t("Done: the mail is sent — note it on the todo")}
            aria-label={t("Done")}
          >
            <CheckIcon className="size-3.5" />
          </button>
        )}
        {/* Not wanted: off the todo, no trace (×). */}
        {todoId !== undefined && (
          <button
            type="button"
            className="shrink-0 rounded px-1 text-sky-700 hover:bg-sky-100 hover:text-red-600 disabled:opacity-50 dark:text-sky-300 dark:hover:bg-sky-900 dark:hover:text-red-400"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await removeTodoOpAction(todoId, index);
                if (!r?.ok) toast(r?.error ?? t("Didn't work."), { tone: "error" });
                router.refresh();
              })
            }
            title={t("Dismiss — takes the action off the todo, without a note")}
            aria-label={t("Dismiss the action")}
          >
            <CloseIcon className="size-3.5" />
          </button>
        )}
        </span>
      </span>
      {note ? (
        <a
          href={note.url}
          target="_blank"
          rel="noreferrer"
          className="block text-xs break-words text-sky-950/80 hover:underline dark:text-sky-100/80"
          title={t("{note} — open in GitLab", { note: "note" in op ? op.note : "" })}
        >
          {note.author ?? t("Comment")}: “{note.excerpt}”{note.state === "resolved" ? ` ${t("(already resolved)")}` : ""} ↗
        </a>
      ) : (
        detail && (
          <span className="block text-xs break-words text-sky-950/80 dark:text-sky-100/80">
            {detail}
          </span>
        )
      )}
      {!!files?.length && (
        <details className="mt-0.5 text-xs text-sky-950/80 dark:text-sky-100/80">
          <summary className="cursor-pointer">{t("Show files")}</summary>
          <ul className="mt-0.5 space-y-0.5 font-mono text-xs">
            {files.map((f) => (
              <li key={f} className="break-all" title={f}>
                {f.includes("/") ? (
                  <span className="text-sky-900/50 dark:text-sky-100/50">
                    {f.slice(0, f.lastIndexOf("/") + 1)}
                  </span>
                ) : null}
                {f.slice(f.lastIndexOf("/") + 1)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {body !== null &&
        (editing ? (
          <span className="mt-1 block space-y-1">
            <textarea
              className="input min-h-20 w-full text-xs"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={Math.min(10, Math.max(3, text.split("\n").length + 1))}
              autoFocus
            />
            <span className="flex gap-1.5">
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={pending || !text.trim()}
                onClick={() =>
                  start(async () => {
                    const r = await saveTodoOpTextAction(todoId!, index, text);
                    if (r && !r.ok)
                      toast(r.error ?? t("Didn't work."), { tone: "error" });
                    else setEditing(false);
                    router.refresh();
                  })
                }
              >
                {pending ? "…" : t("Save")}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={pending}
                onClick={() => setEditing(false)}
              >
                {t("Cancel")}
              </button>
            </span>
          </span>
        ) : (
          body &&
          (op.type === "jira-create" ? (
            // A new ticket's description is long: folded, its title above says what it is.
            <details className="mt-0.5 text-xs text-sky-950/80 dark:text-sky-100/80">
              <summary className="cursor-pointer">{t("Show description")}</summary>
              <span className="mt-0.5 block whitespace-pre-wrap">{body}</span>
            </details>
          ) : (
            <span className="mt-0.5 block text-xs whitespace-pre-wrap text-sky-950/80 dark:text-sky-100/80">
              {body}
            </span>
          ))
        ))}
    </span>
  );
}

/** Where an action's pre-filled window opens, by its address: Gmail, Google Calendar, Outlook. */
function openIn(href: string): string {
  if (href.startsWith("https://mail.google.com")) return "Gmail";
  if (href.startsWith("https://calendar.google.com")) return "Google Calendar";
  if (/outlook\.(office|live)\.com|office365/.test(href)) return "Outlook";
  return "neuem Fenster";
}
