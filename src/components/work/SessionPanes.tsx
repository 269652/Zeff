import { extWorkPanels } from "@/lib/ext/work";
import Link from "next/link";
import { getTodo } from "@/lib/boards/store";
import { todoRef } from "@/lib/boards/shared";
import { getTicketCards } from "@/lib/jira/store";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import type { SessionTicket } from "@/lib/work/sessions";
import { isActive, WORK_MODE_LABELS, type WorkRunView, type WorkStatus } from "@/lib/work/shared";
import { sideTodos } from "@/lib/work/actions";
import { runsForTodos } from "@/lib/work/store";
import { ClaudeSession } from "./ClaudeSession";
import { LiveControls } from "./LiveControls";
import { SessionComposer } from "./SessionComposer";
import type { ComposerOptions } from "@/lib/work/composer-shared";
import { SessionThread, type SessionTurn } from "./SessionThread";
import { SessionTabs } from "./SessionWorkspace";
import { StopSessionButton } from "./SessionActions";
import { SessionBranch } from "./SessionBranch";

type Options = { tickets: { key: string; summary: string | null }[]; repos: { id: number; name: string; path: string }[]; providers: { id: string; label: string }[]; composer?: ComposerOptions; ticketRepos?: Record<string, string> };

const when = (iso: string | null) => (iso ? formatDateTime(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`) : "");
const statusText = (s: WorkStatus) =>
  ({ queued: t("queued"), running: t("working"), done: t("done"), failed: t("failed"), cancelled: t("stopped"), interrupted: t("interrupted") })[s] ?? s;
const TONE: Record<string, string> = {
  running: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
  queued: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  cancelled: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800",
  interrupted: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
};

/** What a run is doing right now, in a few words. */
function liveStatus(r: WorkRunView): string {
  if (r.session) return r.session.asks.length ? t("waits for your answer") : r.session.host === "starting" ? t("starting") : r.live?.busy ? t("working") : t("waiting for you");
  if (r.live) return r.live.permission ? t("asks for permission") : r.live.busy ? t("working") : t("waiting for you");
  return statusText(r.status);
}

/**
 * A session, like a conversation in Claude Code: what it's about on top; the conversation the whole
 * height — each message of yours (a run each) and its answer, live while it works — with its
 * changes and dev servers beside it; at the bottom a live Claude session's bar (its mode, what it
 * asks, your next message), or the box for your next message, which goes on with the conversation.
 */
export function SessionPane({ run, options }: { run: WorkRunView; options: Options }) {
  const todo = getTodo(run.todoId);
  const card = run.ticket ? getTicketCards([run.ticket])[run.ticket.toUpperCase()] : undefined;
  // The conversation: every run on this todo, oldest first; your words for each from the todo's notes.
  const runs = [...(runsForTodos([run.todoId]).get(run.todoId) ?? [run])].reverse();
  const turns: SessionTurn[] = runs.map((r) => ({
    run: r,
    ask: todo?.userNotes.filter((n) => n.kind === "instruction" && n.run === r.id).map((n) => n.text).join("\n\n") || null,
    label: `${WORK_MODE_LABELS[r.mode]}${todo ? ` · ${todoRef(todo.id)} ${todo.text}` : ""}`,
  }));
  const last = runs[runs.length - 1] ?? run;
  const active = isActive(last.status);
  // Every todo being worked on in this session: its own, and those it took on the way (the worker's start-todo actions).
  const side = sideTodos(runs.map((r) => r.id)).filter((s) => s.todoId !== run.todoId);
  const cost = runs.reduce((n, r) => n + (r.costUsd ?? 0), 0) + (last.session?.costUsd && !last.costUsd ? last.session.costUsd : 0);
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col max-lg:min-h-[80vh]">
      <header className="flex items-center gap-3 border-b border-zinc-200 pb-2.5 dark:border-zinc-800">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold" title={todo?.text ?? undefined}>
            {todo?.text ?? last.summary ?? last.ref}
          </h1>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-px font-medium ${TONE[last.status] ?? ""}`}>
              {/* (The dot keeps its place when idle: the header doesn't shift when a turn starts or ends.) */}
              <span className={`size-1.5 rounded-full bg-current ${active ? "animate-pulse" : "invisible"}`} aria-hidden />
              {liveStatus(last)}
            </span>
            {last.session?.elevated && <span className="rounded bg-red-100 px-1.5 font-semibold text-red-800 dark:bg-red-950 dark:text-red-200">{t("Administrator")}</span>}
            {last.ticket ? (
              <Link href={`/work?ticket=${encodeURIComponent(last.ticket)}`} className="font-mono text-indigo-600 hover:underline dark:text-indigo-400">
                {last.ticket}
              </Link>
            ) : (
              <span>{t("no ticket")}</span>
            )}
            {card?.summary && <span className="max-w-72 truncate">{card.summary}</span>}
            <SessionBranch runId={last.id} repo={last.repo} cwd={last.cwd} branch={last.branch} worktree={!!last.cwd && !!last.repo && last.cwd !== last.repo} idle={!active} />
            {todo && (
              // The session's own todo: always a chip (the same size idle and working) — lit while it's worked on.
              <Link
                href={`/t/${todo.id}`}
                title={todo.text}
                className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-px font-mono whitespace-nowrap ${active ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}
              >
                <span className={`size-1.5 shrink-0 rounded-full bg-current ${active ? "animate-pulse" : "invisible"}`} aria-hidden />
                {todoRef(todo.id)}
              </Link>
            )}
            {cost > 0 && <span>${cost.toFixed(2)}</span>}
          </div>
          {side.length > 0 && (
            <div role="group" className="mt-1 flex flex-wrap items-center gap-1.5 text-xs" aria-label={t("Todos being worked on")}>
              {side.map((s) => {
                const t = getTodo(s.todoId);
                return (
                  <Link
                    key={s.todoId}
                    href={`/t/${s.todoId}`}
                    title={t?.text}
                    className={`inline-flex max-w-64 items-center gap-1 rounded-full px-2 py-px ${s.active ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"}`}
                  >
                    {s.active && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-current" aria-hidden />}
                    <span className="font-mono">{todoRef(s.todoId)}</span>
                    <span className="truncate">{t?.text}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <a href={`/api/work/${last.id}/prompt`} target="_blank" rel="noreferrer" className="btn btn-sm" title={t("What the worker was told")}>
            {t("Prompt")}
          </a>
          {active && <StopSessionButton runId={last.id} />}
        </div>
      </header>
      <SessionTabs
        key={last.id}
        runId={last.id}
        git={!!last.cwd && !!last.repo}
        title={`${last.ticket ? `${last.ticket}: ` : ""}${todo?.text ?? ""}`.slice(0, 120)}
        extPanels={extWorkPanels("session").map((x) => ({ id: x.id, plugin: x.plugin, entry: x.entry, title: x.title }))}
        extContext={{ runId: last.id, ticket: last.ticket || undefined, todoId: run.todoId }}
      >
        <SessionThread turns={turns} />
        <div className="pt-2">
          {last.session && last.status === "running" ? (
            <ClaudeSession key={last.id} run={last} />
          ) : last.live && last.status === "running" ? (
            <LiveControls run={last} />
          ) : (
            <SessionComposer
              ticket={last.ticket}
              continueRunId={last.id}
              continueProvider={last.provider}
              providers={options.providers}
              options={options.composer}
              placeholder={active ? (last.status === "queued" ? "Waiting for a free worker … — your reply is sent after it" : "Working … — your reply is sent as soon as it has answered") : t("Reply …")}
              autoFocus
            />
          )}
        </div>
      </SessionTabs>
    </div>
  );
}

/** A ticket: what it is, its sessions — and a new session on it. */
export function TicketPane({ ticket, data, options }: { ticket: string; data: SessionTicket | undefined; options: Options }) {
  const card = ticket ? getTicketCards([ticket])[ticket.toUpperCase()] : undefined;
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <header>
        <h1 className="text-lg font-semibold">
          <span className="font-mono">{ticket || t("No ticket")}</span>
          {card?.url && (
            <a href={card.url} target="_blank" rel="noreferrer" className="ml-2 text-sm font-normal text-indigo-600 hover:underline dark:text-indigo-400">
              {t("open ↗")}
            </a>
          )}
        </h1>
        {card?.summary && <p className="text-sm text-zinc-600 dark:text-zinc-400">{card.summary}</p>}
        {card && <p className="text-xs text-zinc-500">{[card.status, card.assignee, card.issueType].filter(Boolean).join(" · ")}</p>}
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <section className="space-y-1.5">
          <h2 className="label">{t("Sessions ({n})", { n: data?.sessions.length ?? 0 })}</h2>
          <ul className="space-y-1">
            {(data?.sessions ?? []).map((s) => (
              <li key={s.id}>
                <Link href={`/work?run=${s.id}`} className="card flex items-center gap-3 p-2.5 text-sm hover:border-indigo-300 dark:hover:border-indigo-700">
                  <span className="font-mono text-xs text-zinc-500">{s.ref}</span>
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  <span className={`rounded px-1.5 py-0.5 text-xs ${TONE[s.status] ?? ""}`}>{s.waiting ? t("waiting for you") : statusText(s.status)}</span>
                  <span className="text-xs text-zinc-400">{when(s.at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <SessionComposer
        ticket={ticket}
        repos={options.repos}
        ticketRepos={options.ticketRepos}
        providers={options.providers}
        options={options.composer}
        placeholder={ticket ? t("New session on {ticket} — what should we work on?", { ticket }) : t("New session — what should we work on?")}
      />
    </div>
  );
}

/** A new session: your message — on a ticket or none, in a repo you pick — and off it goes. */
export function NewSessionPane({ options, running }: { options: Options; running: number }) {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col justify-center gap-6 pb-[12vh]">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t("What should we work on?")}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {running
            ? t("Ask a question or give a task — on a ticket, in its repo or one you pick. Sessions run side by side ({n} working now).", { n: running })
            : t("Ask a question or give a task — on a ticket, in its repo or one you pick. Sessions run side by side.")}
        </p>
      </div>
      <SessionComposer tickets={options.tickets} repos={options.repos}
        ticketRepos={options.ticketRepos} providers={options.providers} options={options.composer} autoFocus />
    </div>
  );
}
