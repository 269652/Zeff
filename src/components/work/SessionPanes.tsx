import Link from "next/link";
import { getTodo, listTodos } from "@/lib/boards/store";
import { todoRef } from "@/lib/boards/shared";
import { getTicketCards } from "@/lib/jira/store";
import type { SessionTicket } from "@/lib/work/sessions";
import { isActive, WORK_MODE_LABELS, WORK_STATUS_LABELS, type WorkRunView } from "@/lib/work/shared";
import { runsForTodos } from "@/lib/work/store";
import { LiveControls } from "./LiveControls";
import { SessionComposer } from "./SessionComposer";
import { SessionThread, type SessionTurn } from "./SessionThread";
import { StopSessionButton, TodoSessionButton } from "./SessionActions";
import { formatDateTime } from "@/lib/format";

type Options = { tickets: { key: string; summary: string | null }[]; repos: { id: number; name: string }[]; providers: { id: string; label: string }[] };

const when = (iso: string | null) => (iso ? formatDateTime(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`) : "");
const STATUS: Record<string, string> = { queued: "queued", running: "working", done: "done", failed: "failed", cancelled: "stopped", interrupted: "interrupted" };
const TONE: Record<string, string> = {
  running: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
  queued: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  cancelled: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800",
  interrupted: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
};

/**
 * A session, like a conversation in Claude Code: what it's about on top; the conversation the whole
 * height — each message of yours (a run each) and its answer, live while it works; at the bottom
 * the box for your next message, which goes on with the same conversation.
 */
export function SessionPane({ run, options }: { run: WorkRunView; options: Options }) {
  const todo = getTodo(run.todoId);
  const card = run.ticket ? getTicketCards([run.ticket])[run.ticket.toUpperCase()] : undefined;
  // The conversation: every run on this todo, oldest first; your words for each from the todo's notes.
  const runs = [...(runsForTodos([run.todoId]).get(run.todoId) ?? [run])].reverse();
  const turns: SessionTurn[] = runs.map((r) => ({
    run: r,
    ask: todo?.userNotes.find((n) => n.kind === "instruction" && n.run === r.id)?.text ?? null,
    label: `${WORK_MODE_LABELS[r.mode]}${todo ? ` · ${todoRef(todo.id)} ${todo.text}` : ""}`,
  }));
  const last = runs[runs.length - 1] ?? run;
  const active = isActive(last.status);
  const meta = [last.repo && last.repo.split(/[\\/]/).pop(), last.branch, todo && todoRef(todo.id)].filter(Boolean) as string[];
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col max-lg:min-h-[80vh]">
      <header className="flex items-center gap-3 border-b border-zinc-200 pb-2.5 dark:border-zinc-800">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold" title={todo?.text ?? undefined}>
            {todo?.text ?? last.summary ?? last.ref}
          </h1>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-px font-medium ${TONE[last.status] ?? ""}`}>
              {active && <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />}
              {last.live ? (last.live.permission ? "asks for permission" : last.live.busy ? "working" : "waiting for you") : STATUS[last.status]}
            </span>
            {last.ticket ? (
              <Link href={`/work?ticket=${encodeURIComponent(last.ticket)}`} className="font-mono text-indigo-600 hover:underline dark:text-indigo-400">
                {last.ticket}
              </Link>
            ) : (
              <span>no ticket</span>
            )}
            {card?.summary && <span className="max-w-72 truncate">{card.summary}</span>}
            {meta.map((m) => (
              <span key={m} className="font-mono">
                {m}
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <a href={`/api/work/${last.id}/prompt`} target="_blank" rel="noreferrer" className="btn btn-sm" title="What the worker was told">
            Prompt
          </a>
          {active && <StopSessionButton runId={last.id} />}
        </div>
      </header>
      <SessionThread turns={turns} />
      <div className="pt-2">
        {last.live && last.status === "running" ? (
          <LiveControls run={last} />
        ) : (
          <SessionComposer
            ticket={last.ticket}
            continueRunId={last.id}
            providers={options.providers}
            busy={active ? (last.status === "queued" ? "Waiting for a free worker …" : "Working — you can reply once it has answered.") : null}
            placeholder="Reply …"
            autoFocus
          />
        )}
      </div>
    </div>
  );
}

/** A ticket: what it is, its sessions, its open todos (each to hand to a worker) — and a new session on it. */
export function TicketPane({ ticket, data, options }: { ticket: string; data: SessionTicket | undefined; options: Options }) {
  const card = ticket ? getTicketCards([ticket])[ticket.toUpperCase()] : undefined;
  const todos = listTodos({ status: "open" }).filter((t) => (t.ticket || "") === ticket || t.alsoTickets.includes(ticket));
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <header>
        <h1 className="text-lg font-semibold">
          <span className="font-mono">{ticket || "No ticket"}</span>
          {card?.url && (
            <a href={card.url} target="_blank" rel="noreferrer" className="ml-2 text-sm font-normal text-indigo-600 hover:underline dark:text-indigo-400">
              open ↗
            </a>
          )}
        </h1>
        {card?.summary && <p className="text-sm text-zinc-600 dark:text-zinc-400">{card.summary}</p>}
        {card && <p className="text-xs text-zinc-500">{[card.status, card.assignee, card.issueType].filter(Boolean).join(" · ")}</p>}
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <section className="space-y-1.5">
          <h2 className="label">Open todos ({todos.length})</h2>
          {todos.length ? (
            <ul className="space-y-1.5">
              {todos.map((t) => (
                <li key={t.id} className="card flex items-start gap-3 p-3 text-sm">
                  <Link href={`/t/${t.id}`} className="shrink-0 font-mono text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                    {todoRef(t.id)}
                  </Link>
                  <span className="min-w-0 flex-1">{t.text}</span>
                  <TodoSessionButton todoId={t.id} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">None.</p>
          )}
        </section>
        <section className="space-y-1.5">
          <h2 className="label">Sessions ({data?.sessions.length ?? 0})</h2>
          <ul className="space-y-1">
            {(data?.sessions ?? []).map((s) => (
              <li key={s.id}>
                <Link href={`/work?run=${s.id}`} className="card flex items-center gap-3 p-2.5 text-sm hover:border-indigo-300 dark:hover:border-indigo-700">
                  <span className="font-mono text-xs text-zinc-500">{s.ref}</span>
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  <span className={`rounded px-1.5 py-0.5 text-xs ${TONE[s.status] ?? ""}`}>{s.waiting ? "waiting for you" : WORK_STATUS_LABELS[s.status]}</span>
                  <span className="text-xs text-zinc-400">{when(s.at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <SessionComposer ticket={ticket} repos={options.repos} providers={options.providers} placeholder={`New session${ticket ? ` on ${ticket}` : ""} — what should we work on?`} />
    </div>
  );
}

/** A new session: your message — on a ticket or none, in a repo you pick — and off it goes. */
export function NewSessionPane({ options, running }: { options: Options; running: number }) {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col justify-center gap-6 pb-[12vh]">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">What should we work on?</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Ask a question or give a task — on a ticket, in its repo or one you pick. Sessions run side by side{running ? ` (${running} working now)` : ""}.
        </p>
      </div>
      <SessionComposer tickets={options.tickets} repos={options.repos} providers={options.providers} autoFocus />
    </div>
  );
}
