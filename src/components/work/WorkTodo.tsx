"use client";

import { actionHref } from "@/plugins/actions/catalog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  dispatchWorkAction,
  doneBrowserOpAction,
  removeTodoOpAction,
  saveTodoDraftAction,
  saveTodoOpTextAction,
  setTodoStatusAction,
} from "@/app/actions";
import {
  agentInstruction,
  opLabel,
  opNote,
  opsButton,
  sourcesOf,
  TODO_KIND_LABELS,
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
  WORK_MODE_LABELS,
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

export type Provider = {
  id: "claude" | "copilot";
  label: string;
  found: boolean;
};

/** "Send to Claude", with the other provider a click away (▾) — or, while it's out, where it is; code work without a repo: where to set one. */
function SendButton({
  t,
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
  const router = useRouter();
  const [pending, start] = useTransition();
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = workModeOf(t);
  if (!m.mode) return null;
  if (m.mode === "code" && !repo && !active)
    return (
      <a
        href="/repos"
        className="shrink-0 text-xs text-amber-700 hover:underline dark:text-amber-400"
        title="Code work needs a repo: assign the ticket's board (or the ticket) to one"
      >
        No repo — set one
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
      const r = await dispatchWorkAction(t.id, provider);
      setError(r && !r.ok ? (r.error ?? "Couldn't hand it out.") : null);
      router.refresh();
    });
  if (m.mode === "send" && t.channel !== "gitlab")
    return (
      <span
        className="max-w-48 shrink-0 text-right text-xs text-zinc-400"
        title="The Ticket-Lage gives every todo its operations (status, assignee, comment …) — then “Run” runs them without AI"
      >
        Its operations come with the next Ticket-Lage
      </span>
    );
  if (
    (m.mode === "send" && t.channel === "gitlab") ||
    m.mode === "mr" ||
    m.mode === "ops"
  )
    return (
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <button
          type="button"
          className={`btn btn-sm ${active ? "" : "btn-primary"}`}
          disabled={pending || !!active || !!t.blockedBy}
          onClick={() => send("claude")}
          title={
            t.blockedBy
              ? `Waiting: ${t.blockedBy} — the GitLab sync notices once it is`
              : m.mode === "ops"
                ? `Zeff does it itself, no AI: ${t.ops.map(opLabel).join(" · ")}`
                : m.mode === "mr"
                  ? "Zeff opens the merge request (first line of the draft: its title, the rest: its description) through GitLab's API in the automation Chrome"
                  : "Zeff posts this draft as a reply in the comment's thread — through GitLab's API in the automation Chrome, else through the page"
          }
        >
          {active
            ? active.status === "queued"
              ? "Queued…"
              : "Working…"
            : pending
              ? "Sending…"
              : m.mode === "ops"
                ? opsButton(t.ops)
                : m.mode === "mr"
                  ? "Open MR"
                  : "Post to GitLab"}
        </button>
        <span
          className={`text-[11px] text-zinc-400 ${m.mode === "ops" ? "hidden" : ""}`}
        >
          {m.mode === "ops"
            ? "no AI"
            : m.mode === "mr"
              ? (parseMrTarget(t.target)?.source ?? "")
              : "reply in its thread"}
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
      ? "It implements the todo in the ticket's repo (its own worktree and branch), commits there, reports back — and leaves follow-ups for what goes out."
      : m.mode === "draft"
        ? "It writes the message this todo asks for — nothing is sent. You read it, change it, then send it (or hand it out again to post it)."
        : "It posts exactly this draft to Jira (comment, status, assignee) through Zeff's Jira connection — then the todo is done.";
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
                ? `${workRef(active.id)} has it`
                : full
                  ? `All ${parallel} workers are busy — wait for one, or allow more in the settings`
                  : hint
            }
          >
            {active
              ? active.status === "queued"
                ? "Queued…"
                : "Running…"
              : pending
                ? "Sending…"
                : m.mode === "draft"
                  ? `Write draft with ${main.label}`
                  : `Send to ${main.label}`}
          </button>
          {others.length > 0 && !active && (
            <button
              type="button"
              className="btn btn-primary btn-sm rounded-l-none border-l border-white/30 px-1.5"
              disabled={pending || full}
              onClick={() => setMenu(!menu)}
              aria-label="Send to another worker"
              aria-expanded={menu}
            >
              ▾
            </button>
          )}
        </div>
      ) : (
        <span
          className="text-xs text-zinc-400"
          title="Install Claude Code (or the Copilot CLI) — see Settings"
        >
          No worker CLI found
        </span>
      )}
      <span className="text-[11px] text-zinc-400">
        {WORK_MODE_LABELS[m.mode]}
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
              Send to {p.label}
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
  const router = useRouter();
  const { heading, detail, body, files } = opNote(op);
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
            title="Öffnet sich ausgefüllt in Outlook — prüfen und selbst senden"
          >
            In Outlook öffnen ↗
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
            title="Text bearbeiten"
            aria-label="Text bearbeiten"
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
                toast(r?.ok ? (r.message ?? "Vermerkt.") : (r?.error ?? "Ging nicht."), { tone: r?.ok ? "ok" : "error" });
                router.refresh();
              })
            }
            title={op.type === "calendar-event" ? "Erledigt: den Termin in Outlook angelegt — am Todo vermerken" : "Erledigt: die Mail gesendet — am Todo vermerken"}
            aria-label="Erledigt"
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
                if (!r?.ok) toast(r?.error ?? "Ging nicht.", { tone: "error" });
                router.refresh();
              })
            }
            title="Entfernen — ohne Vermerk"
            aria-label="Aktion entfernen"
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
          title={`${"note" in op ? op.note : ""} — in GitLab öffnen`}
        >
          {note.author ?? "Kommentar"}: „{note.excerpt}“{note.state === "resolved" ? " (schon aufgelöst)" : ""} ↗
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
          <summary className="cursor-pointer">Dateien zeigen</summary>
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
                      toast(r.error ?? "Ging nicht.", { tone: "error" });
                    else setEditing(false);
                    router.refresh();
                  })
                }
              >
                {pending ? "…" : "Speichern"}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={pending}
                onClick={() => setEditing(false)}
              >
                Abbrechen
              </button>
            </span>
          </span>
        ) : (
          body &&
          (op.type === "jira-create" ? (
            // A new ticket's description is long: folded, its title above says what it is.
            <details className="mt-0.5 text-xs text-sky-950/80 dark:text-sky-100/80">
              <summary className="cursor-pointer">Beschreibung zeigen</summary>
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
function DraftBox({ t, targetUrl }: { t: TodoView; targetUrl: string | null }) {
  const saved = t.draft ?? "";
  const [text, setText] = useState(saved);
  const [from, setFrom] = useState(saved);
  if (from !== saved) {
    setFrom(saved);
    setText(saved);
  }
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const dirty = text.trim() !== saved.trim();
  const where = t.channel ? CHANNEL_LABELS[t.channel] : null;
  const m = workModeOf({ ...t, draft: text });
  return (
    <div className="ml-6 space-y-1.5 rounded-md border border-dashed border-zinc-300 p-2 dark:border-zinc-700">
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <span className="font-semibold uppercase">Draft</span>
        <span>
          {where
            ? `for ${where}`
            : saved
              ? ""
              : "none yet — “Write draft” lets a worker write it, or write it yourself"}
          {t.target ? ` → ${t.target}` : ""}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {dirty && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await saveTodoDraftAction(t.id, text);
                  setError(
                    r && !r.ok ? (r.error ?? "Couldn't save it.") : null,
                  );
                })
              }
            >
              {pending ? "Saving…" : "Save draft"}
            </button>
          )}
          {text.trim() && (
            <CopyButton
              text={text}
              className="btn btn-sm"
              title="Copy the draft"
            />
          )}
          {targetUrl && where && (
            <a
              href={targetUrl}
              target="_blank"
              rel="noreferrer"
              className="btn btn-sm"
              title={`Open where it goes, to send it yourself`}
            >
              Open in {where} ↗
            </a>
          )}
        </span>
      </div>
      <textarea
        className="input text-sm"
        rows={Math.min(14, Math.max(3, text.split("\n").length + 1))}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="The message — a worker drafts it, or write it here."
        aria-label={`Draft for ${todoRef(t.id)}`}
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
  t,
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
  const instructions = useAgentInstructions();
  const [status, setStatus] = useState(t.status);
  const [fromStatus, setFromStatus] = useState(t.status);
  if (fromStatus !== t.status) {
    setFromStatus(t.status);
    setStatus(t.status);
  }
  const [, start] = useTransition();
  const [quick, setQuick] = useState<QuickPanel>(null);
  const closed = status !== "open";
  const opsMode = !closed && t.ops.length > 0 && workModeOf(t).mode === "ops";
  const active = runs.find((r) => isActive(r.status));
  const cameFrom = sourcesOf(t.refs, sources);
  const comms = COMMS_KINDS.includes(t.kind);
  return (
    <li
      id={`work-todo-${t.id}`}
      className={`group scroll-mt-24 space-y-1.5 rounded-md target:bg-amber-50 dark:target:bg-amber-950/30 ${active ? "-mx-2 bg-indigo-50 px-2 py-1.5 ring-1 ring-indigo-200 dark:bg-indigo-950/40 dark:ring-indigo-900" : ""}`}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-1 size-4 shrink-0 cursor-pointer accent-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
          checked={closed}
          disabled={!!active}
          title={
            active ? `${active.ref} is on it — when it's through` : undefined
          }
          onChange={() => {
            const before = status;
            const next = closed ? "open" : "done";
            setStatus(next);
            start(async () => {
              const r = await setTodoStatusAction(t.id, next);
              if (r && !r.ok) {
                setStatus(t.status);
                toast(r.error ?? `Couldn't change ${todoRef(t.id)}.`, {
                  tone: "error",
                });
                return;
              }
              toast(
                next === "done"
                  ? `${todoRef(t.id)} done.`
                  : `${todoRef(t.id)} is open again.`,
                {
                  action: {
                    label: "Undo",
                    run: () => setTodoStatusAction(t.id, before),
                  },
                },
              );
            });
          }}
          aria-label={`${todoRef(t.id)} ${closed ? "open again" : "done"}`}
        />
        <div className="min-w-0 flex-1 text-sm">
          <div
            className={
              closed
                ? "text-zinc-400 line-through"
                : t.owner === "other"
                  ? "text-zinc-600 italic dark:text-zinc-300"
                  : ""
            }
          >
            {t.needsInput && !closed && (
              <span className="mr-1 font-bold text-amber-600 not-italic dark:text-amber-400" title={`The agent is waiting for you: ${t.needsInput}`} aria-label="Waiting for you">
                ❗
              </span>
            )}
            {active && !closed && !t.needsInput && <RunningSpinner title={active.status === "queued" ? `${active.ref} wartet auf einen freien Worker` : `${active.ref} arbeitet daran`} />}
            <Linked text={t.text} cards={cards} mrs={t.links?.mrs} />
          </div>
          {t.needsInput && !closed && (
            <div className="mt-0.5 text-xs whitespace-pre-line text-amber-700 dark:text-amber-300">
              <strong>Waiting for you:</strong> {t.needsInput}
            </div>
          )}
          <div className="text-xs text-zinc-400">
            <CopyButton
              text={agentInstruction(t, instructions)}
              className="font-mono hover:text-indigo-600 hover:underline dark:hover:text-indigo-400"
              title={`„${agentInstruction(t, instructions)}“ kopieren — für Copilot / Claude Code`}
            >
              {todoRef(t.id)}
            </CopyButton>{" "}
            <Link
              href={`/todos${closed ? "?todos=done" : ""}#todo-${t.id}`}
              className="hover:underline"
              title={`${todoRef(t.id)} auf dem Todos-Tab zeigen`}
            >
              ↗
            </Link>{" "}
            <TodoMrLinks mrs={t.links?.mrs} />
            {" "}· {TODO_KIND_LABELS[t.kind]}
            {t.path && <> · path “{t.path}”</>}
            {t.parentId && (
              <>
                {" "}
                · follows{" "}
                <a
                  href={`#work-todo-${t.parentId}`}
                  className="font-mono hover:underline"
                >
                  {todoRef(t.parentId)}
                </a>
              </>
            )}
            {t.workRunId && t.parentId && (
              <>
                {" "}
                · from{" "}
                <a
                  href={`#w-${t.workRunId}`}
                  className="font-mono hover:underline"
                >
                  {workRef(t.workRunId)}
                </a>
              </>
            )}
            {t.note && (
              <>
                {" "}
                · <TodoRefs text={t.note} />
              </>
            )}
            {!closed && <TodoQuickButtons todoId={t.id} panel={quick} onToggle={setQuick} aiDisabled={active ? `${active.ref} arbeitet schon daran` : undefined} />}
            {!closed && <FlagButton todoId={t.id} todoRef={todoRef(t.id)} flagged={!!t.flaggedAt} className="ml-0.5 inline-flex size-5 items-center justify-center rounded align-middle hover:bg-zinc-100 dark:hover:bg-zinc-800 [&_svg]:size-3.5" />}
            {t.flaggedAt && !closed && <span className="font-medium text-red-600 dark:text-red-400"> · wichtig</span>}
          </div>
          <TodoQuickPanel todoId={t.id} todoRef={todoRef(t.id)} panel={closed ? null : quick} onClose={() => setQuick(null)} />
          <TodoContext t={t} cameFrom={cameFrom} />
          <TodoPlan t={{ planned: t.planned, status }} />
          {opsMode ? (
            // The operations and their button in one row (centred), each alternative a row below.
            <span className="mt-1.5 flex flex-col gap-1.5">
              <span className="flex items-center gap-2 max-sm:flex-col max-sm:items-start">
                <OpChips
                  ops={t.ops}
                  todoId={active ? undefined : t.id}
                  notes={t.links?.notes}
                  className="min-w-0 flex-1 items-stretch"
                />
                <SendButton
                  t={t}
                  providers={providers}
                  preferred={preferred}
                  active={active}
                  repo={repo}
                  full={full}
                  parallel={parallel}
                />
              </span>
              {!active && <TodoAlternatives t={t} />}
            </span>
          ) : (
            t.ops.length > 0 &&
            !closed && (
              <OpChips ops={t.ops} todoId={active ? undefined : t.id} notes={t.links?.notes} />
            )
          )}
        </div>
        {!closed && !opsMode && (
          <SendButton
            t={t}
            providers={providers}
            preferred={preferred}
            active={active}
            repo={repo}
            full={full}
            parallel={parallel}
          />
        )}
      </div>
      {comms && !closed && t.owner === "me" && (!t.ops.length || !!t.draft) && (
        <DraftBox t={t} targetUrl={targetUrl} />
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
                {r.status === "queued" ? "is waiting" : "is working on it"} —
                its log is at the top ↑
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
