"use client";

import { actionHref } from "@/plugins/actions/catalog";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { doneBrowserOpAction, removeTodoOpAction, saveTodoOpTextAction } from "@/plugins/todos/server-actions";
import { opNote, type TodoView } from "@/lib/boards/shared";
import { opLook } from "@/lib/boards/op-look";
import { ActionCard, TOOL_BUTTON } from "./ActionCard";
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
  action,
}: {
  ops: TodoView["ops"];
  /** The button that runs the (single) action, shown inside its card. */
  action?: ReactNode;
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
        <OpChip key={i} op={o} index={indices?.[i] ?? i} todoId={todoId} note={"note" in o ? notes[o.note] : undefined} action={ops.length === 1 ? action : undefined} />
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
  action,
}: {
  op: TodoView["ops"][number];
  action?: ReactNode;
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
  const look = opLook(op.type);
  const [more, setMore] = useState(false);
  const tools = (
    <>
      {body !== null && todoId !== undefined && !editing && (
        <button
          type="button"
          className={TOOL_BUTTON}
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
          className={`${TOOL_BUTTON} hover:!text-emerald-600`}
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
          className={`${TOOL_BUTTON} hover:!text-red-600`}
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
    </>
  );
  const detailNode = note ? (
    <a
      href={note.url}
      target="_blank"
      rel="noreferrer"
      className="hover:text-indigo-600 hover:underline dark:hover:text-indigo-300"
      title={t("{note} — open in GitLab", { note: "note" in op ? op.note : "" })}
    >
      {note.author ?? t("Comment")}: “{note.excerpt}”{note.state === "resolved" ? ` ${t("(already resolved)")}` : ""} ↗
    </a>
  ) : (
    detail
  );
  return (
    <ActionCard tone={look.tone} icon={look.icon} title={heading} detail={detailNode} action={action} tools={tools}>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="self-start rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700 hover:bg-sky-100 dark:bg-sky-950 dark:text-sky-300 dark:hover:bg-sky-900"
          title={t("Opens filled in in {app} — check it and send it yourself", { app: openIn(href) })}
        >
          {t("Open in {app}", { app: openIn(href) })} ↗
        </a>
      )}
      {!!files?.length && (
        <details className="text-xs text-zinc-500 dark:text-zinc-400">
          <summary className="cursor-pointer">{t("Show files")}</summary>
          <ul className="mt-0.5 space-y-0.5 font-mono text-xs">
            {files.map((f) => (
              <li key={f} className="break-all" title={f}>
                {f.includes("/") ? (
                  <span className="text-zinc-400 dark:text-zinc-500">
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
            <details className="text-xs text-zinc-500 dark:text-zinc-400">
              <summary className="cursor-pointer">{t("Show description")}</summary>
              <span className="mt-0.5 block whitespace-pre-wrap">{body}</span>
            </details>
          ) : (
            // The draft, as a quote: what will be sent, readable at a glance (longer ones fold).
            <span className="block rounded-md bg-zinc-50 px-2.5 py-2 text-sm text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200">
              <span className={`block whitespace-pre-wrap ${more || body.length < 320 ? "" : "line-clamp-5"}`}>{body}</span>
              {body.length >= 320 && (
                <button type="button" className="mt-1 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setMore((v) => !v)}>
                  {more ? t("Show less") : t("Show all")}
                </button>
              )}
            </span>
          ))
        ))}
    </ActionCard>
  );
}

/** Where an action's pre-filled window opens, by its address: Gmail, Google Calendar, Outlook. */
function openIn(href: string): string {
  if (href.startsWith("https://mail.google.com")) return "Gmail";
  if (href.startsWith("https://calendar.google.com")) return "Google Calendar";
  if (/outlook\.(office|live)\.com|office365/.test(href)) return "Outlook";
  return "neuem Fenster";
}
