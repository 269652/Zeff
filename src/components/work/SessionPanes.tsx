import Link from "next/link";
import { getTodo, listTodos } from "@/lib/boards/store";
import { todoRef } from "@/lib/boards/shared";
import { getTicketCards } from "@/lib/jira/store";
import type { SessionTicket } from "@/lib/work/sessions";
import { duration, isActive, WORK_MODE_LABELS, WORK_STATUS_LABELS, type WorkRunView } from "@/lib/work/shared";
import { LiveControls } from "./LiveControls";
import { RunLog } from "./RunLog";
import { SessionComposer } from "./SessionComposer";
import { StopSessionButton, TodoSessionButton } from "./SessionActions";

type Options = { tickets: { key: string; summary: string | null }[]; repos: { id: number; name: string }[]; providers: { id: string; label: string }[] };

const when = (iso: string | null) => (iso ? new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`).toLocaleString("de-DE", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const PROVIDER: Record<string, string> = { copilot: "Copilot CLI", claude: "Claude CLI", zeff: "Zeff", agent: "Agent" };
const TONE: Record<string, string> = {
  running: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
  queued: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  cancelled: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800",
  interrupted: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
};

/**
 * A session, like a conversation in Claude Code: what it's about on top; what the worker says
 * and does, the whole height (live while it works); at the bottom the bar to talk to it — its
 * mode, its questions, your next message — or, once it's over, to go on in a new session.
 */
export function SessionPane({ run, options }: { run: WorkRunView; options: Options }) {
  const todo = getTodo(run.todoId);
  const card = run.ticket ? getTicketCards([run.ticket])[run.ticket.toUpperCase()] : undefined;
  const active = isActive(run.status);
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-3 max-lg:min-h-[80vh]">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono font-semibold">{run.ref}</span>
            <span className={`rounded px-1.5 py-0.5 font-medium ${TONE[run.status] ?? ""}`}>{run.live ? (run.live.permission ? "fragt nach Erlaubnis" : run.live.busy ? "arbeitet" : "wartet auf dich") : WORK_STATUS_LABELS[run.status]}</span>
            {run.ticket ? (
              <Link href={`/work?ticket=${encodeURIComponent(run.ticket)}`} className="font-mono text-indigo-600 hover:underline dark:text-indigo-400">
                {run.ticket}
              </Link>
            ) : (
              <span className="text-zinc-500">ohne Ticket</span>
            )}
            {card?.summary && <span className="truncate text-zinc-500">{card.summary}</span>}
          </div>
          <h1 className="mt-1 text-base font-semibold">{todo?.text ?? run.summary ?? run.ref}</h1>
          <p className="text-xs text-zinc-500">
            {[
              `${PROVIDER[run.provider] ?? run.provider}${run.model ? ` · ${run.model}` : ""}`,
              WORK_MODE_LABELS[run.mode],
              run.repo && `Repo ${run.repo.split(/[\\/]/).pop()}`,
              run.branch && `Branch ${run.branch}`,
              run.startedAt && `seit ${when(run.startedAt)}`,
              run.durationMs ? duration(run.durationMs) : null,
              todo && todoRef(todo.id),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <a href={`/api/work/${run.id}/prompt`} target="_blank" rel="noreferrer" className="btn btn-sm" title="Was der Worker bekommen hat">
            Auftrag
          </a>
          {active && <StopSessionButton runId={run.id} />}
        </div>
      </header>
      <RunLog id={run.id} fill />
      {run.live ? (
        <LiveControls run={run} />
      ) : active ? (
        <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          {run.status === "queued" ? "Wartet auf einen freien Worker …" : "Arbeitet — ohne Rückfragen (nicht interaktiv; interaktiv: Copilot CLI, Work-Einstellungen „interaktiv“)."}
        </p>
      ) : (
        <div className="space-y-2">
          {(run.summary || run.error) && (
            <div className={`rounded-lg px-3 py-2 text-sm ${run.error ? "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200" : "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"}`}>
              {run.error ?? run.summary}
              {run.gitSummary && <span className="mt-1 block text-xs opacity-80">{run.gitSummary}</span>}
            </div>
          )}
          <SessionComposer ticket={run.ticket} todoId={todo?.status === "open" ? todo.id : undefined} repos={options.repos} providers={options.providers} label="Weiter" placeholder="Weitermachen — was als Nächstes? (eine neue Session mit allem bisher)" />
        </div>
      )}
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
          <span className="font-mono">{ticket || "Ohne Ticket"}</span>
          {card?.url && (
            <a href={card.url} target="_blank" rel="noreferrer" className="ml-2 text-sm font-normal text-indigo-600 hover:underline dark:text-indigo-400">
              öffnen ↗
            </a>
          )}
        </h1>
        {card?.summary && <p className="text-sm text-zinc-600 dark:text-zinc-400">{card.summary}</p>}
        {card && <p className="text-xs text-zinc-500">{[card.status, card.assignee, card.issueType].filter(Boolean).join(" · ")}</p>}
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <section className="space-y-1.5">
          <h2 className="label">Offene Todos ({todos.length})</h2>
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
            <p className="text-sm text-zinc-500">Keine.</p>
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
                  <span className={`rounded px-1.5 py-0.5 text-xs ${TONE[s.status] ?? ""}`}>{s.waiting ? "wartet auf dich" : WORK_STATUS_LABELS[s.status]}</span>
                  <span className="text-xs text-zinc-400">{when(s.at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <SessionComposer ticket={ticket} repos={options.repos} providers={options.providers} placeholder={`Neue Session${ticket ? ` zu ${ticket}` : ""} — was soll der Worker tun?`} />
    </div>
  );
}

/** A new session: your instruction — on a ticket or none, in a repo you pick — and off it goes. */
export function NewSessionPane({ options, running }: { options: Options; running: number }) {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col justify-end gap-4">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="text-center">
          <h1 className="text-xl font-semibold">Neue Session</h1>
          <p className="text-sm text-zinc-500">
            Ein Worker (Copilot CLI, interaktiv) arbeitet an deiner Anweisung — im Repo des Tickets oder dem gewählten. Du redest mit ihm auf seiner Seite, mehrere Sessions laufen nebeneinander
            {running ? ` (gerade ${running})` : ""}.
          </p>
        </div>
        <SessionComposer tickets={options.tickets} repos={options.repos} providers={options.providers} />
      </div>
    </div>
  );
}
