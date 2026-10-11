"use client";

import { actionHref } from "@/plugins/actions/catalog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { dispatchWorkAction } from "@/plugins/work/server-actions";
import { doneBrowserOpAction, removeTodoOpAction, saveTodoDraftAction, saveTodoOpTextAction, setTodoStatusAction } from "@/plugins/todos/server-actions";
import {
  agentInstruction,
  opTitle,
  opNote,
  opsButton,
  sourcesOf,
  todoKindLabels,
  todoRef,
  type TodoSource,
  type TodoView,
} from "@/lib/boards/shared";
import type { TicketCard } from "@/lib/jira/ticket-card-shared";
import {
  CHANNEL_LABELS,
  COMMS_KINDS,
  isActive,
  parseMrTarget,
  workModeLabels,
  workModeOf,
  workRef,
  type WorkRunView,
} from "@/lib/work/shared";
import { Linked, TodoMrLinks } from "../boards/TodoItem";
import { TodoRefs } from "../boards/TodoRefs";
import { OP_CHIP, TodoAlternatives } from "../boards/TodoAlternatives";
import { TodoContext } from "../boards/TodoSources";
import { TodoPlan } from "../boards/TodoPlan";
import { CopyButton } from "../CopyButton";
import { toast } from "../Toaster";
import { useAgentInstructions } from "../AgentInstructions";
import { CheckIcon, CloseIcon, PencilIcon } from "../icons";
import { RunningSpinner } from "../RunningSpinner";
import { RunPanel } from "./RunPanel";
import { TodoQuickButtons, TodoQuickPanel, type QuickPanel } from "../boards/TodoQuick";
import { FlagButton } from "../boards/FlagButton";
import { useT } from "@/components/I18nProvider";

export type Provider = {
  id: "claude" | "copilot";
  label: string;
  found: boolean;
};

/** "Send to Claude", with the other provider a click away (▾) — or, while it's out, where it is; code work without a repo: where to set one. */
function SendButton({
  t: todo,
  providers,
  preferred,
  active,
  repo,
  full,
  parallel,
}: {
  t: TodoView;
  providers: Provider[];
  preferred: Provider["id"];
  active: WorkRunView | undefined;
  repo: string | null;
  /** All workers busy: nothing more to hand out until one is free. */
  full: boolean;
  parallel: number;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = workModeOf(todo, t);
  if (!m.mode) return null;
  if (m.mode === "code" && !repo && !active)
    return (
      <a
        href="/repos"
        className="shrink-0 text-xs text-amber-700 hover:underline dark:text-amber-400"
        title={t("Code work needs a repo: assign the ticket's board (or the ticket) to one")}
      >
        {t("No repo — set one")}
      </a>
    );
  const usable = providers.filter(
    (p) => p.found && (m.mode !== "send" || p.id === "claude"),
  );
  const main = usable.find((p) => p.id === preferred) ?? usable[0];
  const others = usable.filter((p) => p !== main);
  const send = (provider: Provider["id"]) =>
    start(async () => {
      setMenu(false);
      const r = await dispatchWorkAction(todo.id, provider);
      setError(r && !r.ok ? (r.error ?? t("Couldn't hand it out.")) : null);
      router.refresh();
    });
  if (m.mode === "send" && todo.channel !== "gitlab")
    return (
      <span
        className="max-w-48 shrink-0 text-right text-xs text-zinc-400"
        title={t("The briefing gives every todo its operations (status, assignee, comment…) — then “Run” runs them without AI")}
      >
        {t("Its operations come with the next briefing")}
      </span>
    );
  if (
    (m.mode === "send" && todo.channel === "gitlab") ||
    m.mode === "mr" ||
    m.mode === "ops"
  )
    return (
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <button
          type="button"
          className={`btn btn-sm ${active ? "" : "btn-primary"}`}
          disabled={pending || !!active || !!todo.blockedBy}
          onClick={() => send("claude")}
          title={
            todo.blockedBy
              ? t("Waiting: {blockedBy} — the GitLab sync notices once it is", { blockedBy: todo.blockedBy })
              : m.mode === "ops"
                ? t("Zeff does it itself, no AI: {ops}", { ops: todo.ops.map((o) => opTitle(o, t)).join(" · ") })
                : m.mode === "mr"
                  ? t("Zeff opens the merge request (first line of the draft: its title, the rest: its description) through GitLab's API in the automation Chrome")
                  : t("Zeff posts this draft as a reply in the comment's thread — through GitLab's API in the automation Chrome, else through the page")
          }
        >
          {active
            ? active.status === "queued"
              ? t("Queued…")
              : t("Working…")
            : pending
              ? t("Sending…")
              : m.mode === "ops"
                ? opsButton(todo.ops, t)
                : m.mode === "mr"
                  ? t("Open MR")
                  : t("Post to GitLab")}
        </button>
        <span
          className={`text-[11px] text-zinc-400 ${m.mode === "ops" ? "hidden" : ""}`}
        >
          {m.mode === "ops"
            ? t("no AI")
            : m.mode === "mr"
              ? (parseMrTarget(todo.target)?.source ?? "")
              : t("reply in its thread")}
        </span>
        {error && (
          <span className="max-w-64 text-right text-xs text-red-600 dark:text-red-400">
            {error}
          </span>
        )}
      </div>
    );
  const hint =
    m.mode === "code"
      ? t("It implements the todo in the ticket's repo (its own worktree and branch), commits there, reports back — and leaves follow-ups for what goes out.")
      : m.mode === "draft"
        ? t("It writes the message this todo asks for — nothing is sent. You read it, change it, then send it (or hand it out again to post it).")
        : t("It posts exactly this draft to Jira (comment, status, assignee) through Zeff's Jira connection — then the todo is done.");
  return (
    <div className="relative flex shrink-0 flex-col items-end gap-0.5">
      {main ? (
        <div className="inline-flex">
          <button
            type="button"
            className={`btn btn-sm ${active ? "" : "btn-primary"} ${others.length ? "rounded-r-none" : ""}`}
            disabled={pending || !!active || full}
            onClick={() => send(main.id)}
            title={
              active
                ? t("{ref} has it", { ref: workRef(active.id) })
                : full
                  ? t("All {parallel} workers are busy — wait for one, or allow more in the settings", { parallel })
                  : hint
            }
          >
            {active
              ? active.status === "queued"
                ? t("Queued…")
                : t("Running…")
              : pending
                ? t("Sending…")
                : m.mode === "draft"
                  ? t("Write draft with {name}", { name: main.label })
                  : t("Send to {name}", { name: main.label })}
          </button>
          {others.length > 0 && !active && (
            <button
              type="button"
              className="btn btn-primary btn-sm rounded-l-none border-l border-white/30 px-1.5"
              disabled={pending || full}
              onClick={() => setMenu(!menu)}
              aria-label={t("Send to another worker")}
              aria-expanded={menu}
            >
              ▾
            </button>
          )}
        </div>
      ) : (
        <span
          className="text-xs text-zinc-400"
          title={t("Install Claude Code (or the Copilot CLI) — see Settings")}
        >
          {t("No worker CLI found")}
        </span>
      )}
      <span className="text-[11px] text-zinc-400">
        {workModeLabels(t)[m.mode]}
      </span>
      {menu && (
        <div className="absolute top-8 right-0 z-20 rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {others.map((p) => (
            <button
              key={p.id}
              type="button"
              className="block w-full px-3 py-1.5 text-left text-sm whitespace-nowrap hover:bg-zinc-50 dark:hover:bg-zinc-800"
              onClick={() => send(p.id)}
            >
              {t("Send to {name}", { name: p.label })}
            </button>
          ))}
        </div>
      )}
      {error && (
        <span className="max-w-64 text-right text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}

/** A todo's operations (what "Run" runs), as notes. */
export function OpChips({
  ops,
  className = "mt-1 items-start",
  todoId,
  notes = {},
}: {
  ops: TodoView["ops"];
  className?: string;
  /** Given: the texts (comment, reply, Teams message) can be edited here before they're sent. */
  todoId?: number;
  /** The GitLab comments the operations are about, as links (by "note:123"). */
  notes?: NonNullable<TodoView["links"]>["notes"];
}) {
  return (
    <span className={`flex flex-col gap-1 ${className}`}>
      {ops.map((o, i) => (
        <OpChip key={i} op={o} index={i} todoId={todoId} note={"note" in o ? notes[o.note] : undefined} />
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
            title={t("Remove — without a note")}
            aria-label={t("Remove the action")}
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
          <ul className="mt-0.5 space-y-0.5 font-mono text-[11px]">
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

/** A todo's message: drafted by a worker (or by you), changed here, copied — or opened where it goes. */
function DraftBox({ t: todo, targetUrl }: { t: TodoView; targetUrl: string | null }) {
  const t = useT();
  const saved = todo.draft ?? "";
  const [text, setText] = useState(saved);
  const [from, setFrom] = useState(saved);
  if (from !== saved) {
    setFrom(saved);
    setText(saved);
  }
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const dirty = text.trim() !== saved.trim();
  const where = todo.channel ? CHANNEL_LABELS[todo.channel] : null;
  const m = workModeOf({ ...todo, draft: text }, t);
  return (
    <div className="ml-6 space-y-1.5 rounded-md border border-dashed border-zinc-300 p-2 dark:border-zinc-700">
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <span className="font-semibold uppercase">{t("Draft")}</span>
        <span>
          {where
            ? t("for {where}", { where })
            : saved
              ? ""
              : t("none yet — “Write draft” lets a worker write it, or write it yourself")}
          {todo.target ? ` → ${todo.target}` : ""}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {dirty && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await saveTodoDraftAction(todo.id, text);
                  setError(
                    r && !r.ok ? (r.error ?? t("Couldn't save it.")) : null,
                  );
                })
              }
            >
              {pending ? t("Saving…") : t("Save draft")}
            </button>
          )}
          {text.trim() && (
            <CopyButton
              text={text}
              className="btn btn-sm"
              title={t("Copy the draft")}
            />
          )}
          {targetUrl && where && (
            <a
              href={targetUrl}
              target="_blank"
              rel="noreferrer"
              className="btn btn-sm"
              title={t("Open where it goes, to send it yourself")}
            >
              {t("Open in {where}", { where })} ↗
            </a>
          )}
        </span>
      </div>
      <textarea
        className="input text-sm"
        rows={Math.min(14, Math.max(3, text.split("\n").length + 1))}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("The message — a worker drafts it, or write it here.")}
        aria-label={t("Draft for {ref}", { ref: todoRef(todo.id) })}
      />
      {saved && !m.mode && m.why && (
        <p className="text-xs text-zinc-500">{m.why}</p>
      )}
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

/**
 * One todo as work: what it asks (ticket keys linked), where it comes from (badges with hover
 * cards), what came before it — the button that hands it to a worker, its message (for a reply,
 * a comment, a ticket change), tick it off by hand; under it every run it had, the live one
 * with its log.
 */
export function WorkTodo({
  t: todo,
  runs,
  sources,
  cards,
  providers,
  preferred,
  targetUrl,
  created,
  repo,
  full,
  parallel,
}: {
  t: TodoView;
  runs: WorkRunView[];
  sources: Record<string, TodoSource>;
  cards: Record<string, TicketCard>;
  providers: Provider[];
  preferred: Provider["id"];
  targetUrl: string | null;
  created: Record<number, { id: number; text: string; done: boolean }[]>;
  /** The repo the ticket's code work goes to (Repos page), if any. */
  repo: string | null;
  /** All workers busy (send waits), of how many. */
  full: boolean;
  parallel: number;
}) {
  const t = useT();
  const instructions = useAgentInstructions();
  const [status, setStatus] = useState(todo.status);
  const [fromStatus, setFromStatus] = useState(todo.status);
  if (fromStatus !== todo.status) {
    setFromStatus(todo.status);
    setStatus(todo.status);
  }
  const [, start] = useTransition();
  const [quick, setQuick] = useState<QuickPanel>(null);
  const closed = status !== "open";
  const opsMode = !closed && todo.ops.length > 0 && workModeOf(todo, t).mode === "ops";
  const active = runs.find((r) => isActive(r.status));
  const cameFrom = sourcesOf(todo.refs, sources);
  const comms = COMMS_KINDS.includes(todo.kind);
  // A worker or agent says it's done: highlighted, still open - closing it is yours.
  const reported = !closed && !todo.needsInput && !active && !!todo.workerDone;
  return (
    <li
      id={`work-todo-${todo.id}`}
      className={`group scroll-mt-24 space-y-1.5 rounded-md target:bg-amber-50 dark:target:bg-amber-950/30 ${active ? "-mx-2 bg-indigo-50 px-2 py-1.5 ring-1 ring-indigo-200 dark:bg-indigo-950/40 dark:ring-indigo-900" : reported ? "-mx-2 bg-emerald-50 px-2 py-1.5 ring-1 ring-emerald-300 dark:bg-emerald-950/30 dark:ring-emerald-800" : ""}`}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-1 size-4 shrink-0 cursor-pointer accent-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
          checked={closed}
          disabled={!!active}
          title={
            active ? t("{ref} is on it — when it's through", { ref: active.ref }) : undefined
          }
          onChange={() => {
            const before = status;
            const next = closed ? "open" : "done";
            setStatus(next);
            start(async () => {
              const r = await setTodoStatusAction(todo.id, next);
              if (r && !r.ok) {
                setStatus(todo.status);
                toast(r.error ?? t("Couldn't change {ref}.", { ref: todoRef(todo.id) }), {
                  tone: "error",
                });
                return;
              }
              toast(
                next === "done"
                  ? t("{ref} done.", { ref: todoRef(todo.id) })
                  : t("{ref} is open again.", { ref: todoRef(todo.id) }),
                {
                  action: {
                    label: t("Undo"),
                    run: () => setTodoStatusAction(todo.id, before),
                  },
                },
              );
            });
          }}
          aria-label={closed ? t("{ref} open again", { ref: todoRef(todo.id) }) : t("{ref} done", { ref: todoRef(todo.id) })}
        />
        <div className="min-w-0 flex-1 text-sm">
          <div
            className={
              closed
                ? "text-zinc-400 line-through"
                : todo.owner === "other"
                  ? "text-zinc-600 italic dark:text-zinc-300"
                  : ""
            }
          >
            {todo.needsInput && !closed && (
              <span className="mr-1 font-bold text-amber-600 not-italic dark:text-amber-400" title={t("The agent is waiting for you: {question}", { question: todo.needsInput })} aria-label={t("Waiting for you")}>
                ❗
              </span>
            )}
            {active && !closed && !todo.needsInput && <RunningSpinner title={active.status === "queued" ? t("{ref} is waiting for a free worker", { ref: active.ref }) : t("{ref} is working on it", { ref: active.ref })} />}
            <Linked text={todo.text} cards={cards} mrs={todo.links?.mrs} />
          </div>
          {todo.needsInput && !closed && (
            <div className="mt-0.5 text-xs whitespace-pre-line text-amber-700 dark:text-amber-300">
              <strong>{t("Waiting for you:")}</strong> {todo.needsInput}
            </div>
          )}
          <div className="text-xs text-zinc-400">
            <CopyButton
              text={agentInstruction(todo, instructions)}
              className="font-mono hover:text-indigo-600 hover:underline dark:hover:text-indigo-400"
              title={t("Copy “{instruction}” — for Copilot / Claude Code", { instruction: agentInstruction(todo, instructions) })}
            >
              {todoRef(todo.id)}
            </CopyButton>{" "}
            <Link
              href={`/todos${closed ? "?todos=done" : ""}#todo-${todo.id}`}
              className="hover:underline"
              title={t("Show {ref} on the Todos tab", { ref: todoRef(todo.id) })}
            >
              ↗
            </Link>{" "}
            <TodoMrLinks mrs={todo.links?.mrs} />
            {" "}· {todoKindLabels(t)[todo.kind]}
            {todo.path && <> · {t("path “{path}”", { path: todo.path })}</>}
            {todo.parentId && (
              <>
                {" "}
                · {t("follows")}{" "}
                <a
                  href={`#work-todo-${todo.parentId}`}
                  className="font-mono hover:underline"
                >
                  {todoRef(todo.parentId)}
                </a>
              </>
            )}
            {todo.workRunId && todo.parentId && (
              <>
                {" "}
                · {t("from")}{" "}
                <a
                  href={`#w-${todo.workRunId}`}
                  className="font-mono hover:underline"
                >
                  {workRef(todo.workRunId)}
                </a>
              </>
            )}
            {todo.note && (
              <>
                {" "}
                · <TodoRefs text={todo.note} />
              </>
            )}
            {!closed && <TodoQuickButtons todoId={todo.id} panel={quick} onToggle={setQuick} aiDisabled={active ? t("{ref} is already working on it", { ref: active.ref }) : undefined} />}
            {!closed && <FlagButton todoId={todo.id} todoRef={todoRef(todo.id)} flagged={!!todo.flaggedAt} className="ml-0.5 inline-flex size-5 items-center justify-center rounded align-middle hover:bg-zinc-100 dark:hover:bg-zinc-800 [&_svg]:size-3.5" />}
            {todo.flaggedAt && !closed && <span className="font-medium text-red-600 dark:text-red-400"> · {t("important")}</span>}
            {reported && todo.workerDone && (
              <span
                className="font-medium text-emerald-700 dark:text-emerald-400"
                title={todo.workerDone.note ? t("{by} reports this done: {note} — tick it off to close it", { by: todo.workerDone.by, note: todo.workerDone.note }) : t("{by} reports this done — tick it off to close it", { by: todo.workerDone.by })}
              >
                {" "}
                · ✓ {t("{by}: reported done", { by: todo.workerDone.by.split(" · ")[0] })}
              </span>
            )}
          </div>
          <TodoQuickPanel todoId={todo.id} todoRef={todoRef(todo.id)} panel={closed ? null : quick} onClose={() => setQuick(null)} />
          <TodoContext t={todo} cameFrom={cameFrom} />
          <TodoPlan t={{ planned: todo.planned, status }} />
          {opsMode ? (
            // The operations and their button in one row (centred), each alternative a row below.
            <span className="mt-1.5 flex flex-col gap-1.5">
              <span className="flex items-center gap-2 max-sm:flex-col max-sm:items-start">
                <OpChips
                  ops={todo.ops}
                  todoId={active ? undefined : todo.id}
                  notes={todo.links?.notes}
                  className="min-w-0 flex-1 items-stretch"
                />
                <SendButton
                  t={todo}
                  providers={providers}
                  preferred={preferred}
                  active={active}
                  repo={repo}
                  full={full}
                  parallel={parallel}
                />
              </span>
              {!active && <TodoAlternatives t={todo} />}
            </span>
          ) : (
            todo.ops.length > 0 &&
            !closed && (
              <OpChips ops={todo.ops} todoId={active ? undefined : todo.id} notes={todo.links?.notes} />
            )
          )}
        </div>
        {!closed && !opsMode && (
          <SendButton
            t={todo}
            providers={providers}
            preferred={preferred}
            active={active}
            repo={repo}
            full={full}
            parallel={parallel}
          />
        )}
      </div>
      {comms && !closed && todo.owner === "me" && (!todo.ops.length || !!todo.draft) && (
        <DraftBox t={todo} targetUrl={targetUrl} />
      )}
      {runs.length > 0 && (
        <div className="space-y-1.5 pl-6">
          {runs.map((r) =>
            isActive(r.status) ? (
              <a
                key={r.id}
                href={`#w-${r.id}`}
                className="block text-xs text-indigo-600 hover:underline dark:text-indigo-400"
              >
                <span className="font-mono">{r.ref}</span>{" "}
                {r.status === "queued" ? t("is waiting — its log is at the top") : t("is working on it — its log is at the top")} ↑
              </a>
            ) : (
              <RunPanel key={r.id} run={r} created={created[r.id] ?? []} />
            ),
          )}
        </div>
      )}
    </li>
  );
}

/** Where an action's pre-filled window opens, by its address: Gmail, Google Calendar, Outlook. */
function openIn(href: string): string {
  if (href.startsWith("https://mail.google.com")) return "Gmail";
  if (href.startsWith("https://calendar.google.com")) return "Google Calendar";
  if (/outlook\.(office|live)\.com|office365/.test(href)) return "Outlook";
  return "neuem Fenster";
}
