"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { cancelWorkAction } from "@/app/actions";
import { todoRef } from "@/lib/boards/shared";
import { duration, isActive, WORK_MODE_LABELS, WORK_STATUS_LABELS, type WorkRunView } from "@/lib/work/shared";
import { CopyButton } from "../CopyButton";
import { ChevronIcon } from "../icons";
import { Markdown } from "../Markdown";
import { RunLog } from "./RunLog";
import { LiveControls } from "./LiveControls";

const STATUS_STYLE: Record<WorkRunView["status"], string> = {
  queued: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  running: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
  done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  cancelled: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  interrupted: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
};
const OUTCOME: Record<NonNullable<WorkRunView["outcome"]>, { text: string; cls: string }> = {
  done: { text: "finished the job", cls: "text-emerald-700 dark:text-emerald-400" },
  partial: { text: "partly done", cls: "text-amber-700 dark:text-amber-400" },
  blocked: { text: "blocked", cls: "text-red-700 dark:text-red-400" },
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

/** Time so far (a running run: ticking — the clock read in an effect, not in render). */
function Elapsed({ run }: { run: WorkRunView }) {
  const [now, setNow] = useState<number | null>(null);
  const running = run.status === "running";
  useEffect(() => {
    if (!running) return;
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [running]);
  if (running && run.startedAt && now) return <span>{duration(now - Date.parse(run.startedAt))}</span>;
  return run.durationMs ? <span>{duration(run.durationMs)}</span> : null;
}

/** What one finished run left: its report, checks, changes, follow-ups, what git says — and how to pick it up. */
function RunResult({ run, created }: { run: WorkRunView; created: { id: number; text: string; done: boolean }[] }) {
  const [prompt, setPrompt] = useState<string | null>(null);
  const res = run.result;
  const resume = run.sessionId && run.provider === "claude" ? `cd "${run.cwd}" && claude --resume ${run.sessionId}` : null;
  return (
    <div className="space-y-2.5 text-sm">
      {run.error && <p className="text-red-700 dark:text-red-400">{run.error}</p>}
      {res && (
        <>
          <p>
            <span className={`font-medium ${OUTCOME[res.outcome].cls}`}>{OUTCOME[res.outcome].text}</span>
            {res.entry ? <span className="text-zinc-600 dark:text-zinc-300"> — {res.entry}</span> : null}
          </p>
          {res.summary && <Markdown text={res.summary} className="text-zinc-700 dark:text-zinc-300" />}
          {res.checks && res.checks.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-zinc-500 uppercase">Checks</div>
              <ul className="list-disc pl-5 text-xs text-zinc-600 dark:text-zinc-300">
                {res.checks.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          {res.changes && res.changes.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-zinc-500 uppercase">Changes</div>
              <ul className="list-disc pl-5 font-mono text-xs text-zinc-600 dark:text-zinc-300">
                {res.changes.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          {(res.completedTodos.length > 0 || created.length > 0) && (
            <p className="text-xs text-zinc-500">
              {res.completedTodos.length > 0 && <>Ticked off: {res.completedTodos.map(todoRef).join(", ")}. </>}
              {created.length > 0 && (
                <>
                  Follow-ups:{" "}
                  {created.map((t, i) => (
                    <span key={t.id}>
                      {i > 0 && ", "}
                      <a href={`#work-todo-${t.id}`} className={`font-mono hover:underline ${t.done ? "line-through" : "text-indigo-600 dark:text-indigo-400"}`} title={t.text}>
                        {todoRef(t.id)}
                      </a>
                    </span>
                  ))}
                </>
              )}
            </p>
          )}
        </>
      )}
      {run.gitSummary && (
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-zinc-500 uppercase">Git</summary>
          <pre className="mt-1 overflow-x-auto rounded bg-zinc-50 p-2 text-xs dark:bg-zinc-900">{run.gitSummary}</pre>
        </details>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-zinc-500">
        {run.cwd && (
          <>
            <dt>Worked in</dt>
            <dd className="font-mono break-all">{run.cwd}</dd>
          </>
        )}
        {run.branch && (
          <>
            <dt>Branch</dt>
            <dd className="font-mono">
              {run.branch} <span className="text-zinc-400">from {run.base}</span>
            </dd>
          </>
        )}
        <dt>Ran</dt>
        <dd>
          {when(run.startedAt)} – {when(run.finishedAt)}
          {run.turns ? ` · ${run.turns} turns` : ""}
          {run.permissionMode ? ` · permissions: ${run.permissionMode}` : ""}
          {run.denials ? ` · ${run.denials} action${run.denials === 1 ? "" : "s"} refused` : ""}
        </dd>
        {run.sessionId && (
          <>
            <dt>Session</dt>
            <dd className="font-mono break-all">{run.sessionId}</dd>
          </>
        )}
      </dl>
      <div className="flex flex-wrap gap-2">
        {resume && (
          <CopyButton text={resume} className="btn btn-sm" title={`Copy: ${resume} — to look at or go on with the session in Claude Code`}>
            Copy resume command
          </CopyButton>
        )}
        <button
          type="button"
          className="btn btn-sm"
          onClick={async () => setPrompt(prompt === null ? await fetch(`/api/work/${run.id}/prompt`).then((r) => r.text()) : null)}
          aria-expanded={prompt !== null}
        >
          {prompt === null ? "Show what it was told" : "Hide the prompt"}
        </button>
      </div>
      {prompt !== null && <pre className="max-h-96 overflow-auto rounded bg-zinc-50 p-2 text-xs whitespace-pre-wrap dark:bg-zinc-900">{prompt}</pre>}
    </div>
  );
}

/**
 * A work run: its reference, state, what it did and with what, its time and cost — the log
 * (open while it runs, live), and once it's done what it left. Stop it while it runs.
 */
export function RunPanel({ run, created = [] }: { run: WorkRunView; created?: { id: number; text: string; done: boolean }[] }) {
  const active = isActive(run.status);
  const [open, setOpen] = useState(active);
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (active) setOpen(true);
  }
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div id={`w-${run.id}`} className="scroll-mt-24 rounded-md border border-zinc-200 bg-white target:ring-2 target:ring-amber-300 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5 text-xs">
        <button type="button" className="inline-flex items-center gap-1 rounded px-1 font-mono font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => setOpen(!open)} aria-expanded={open} title={open ? "Fold" : "Show the log and the result"}>
          <ChevronIcon open={open} className="size-3.5 text-zinc-400" />
          {run.ref}
        </button>
        <span className={`rounded px-1.5 py-0.5 font-medium ${STATUS_STYLE[run.status]}`}>
          {run.status === "running" && <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-indigo-500 align-middle" aria-hidden />}
          {WORK_STATUS_LABELS[run.status]}
        </span>
        {run.outcome && <span className={OUTCOME[run.outcome].cls}>{OUTCOME[run.outcome].text}</span>}
        <span className="text-zinc-500">
          {run.provider === "agent"
            ? `${run.model ?? "Agent"} · extern (MCP)`
            : run.provider === "zeff"
              ? run.mode === "mr"
                ? "merge request · Zeff"
                : run.mode === "ops"
                  ? "operations · Zeff"
                  : "reply in GitLab · Zeff"
              : `${WORK_MODE_LABELS[run.mode]} · ${run.provider === "copilot" ? (run.permissionMode?.startsWith("acp") ? "Copilot · interaktiv" : "Copilot") : "Claude"}`}
          {run.model && run.provider !== "agent" ? ` (${run.model})` : ""}
        </span>
        {run.branch && (
          <span
            className="inline-flex max-w-64 items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            title={`Its worktree's branch, from ${run.base ?? "?"}${run.cwd ? ` — in ${run.cwd}` : ""}`}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" className="size-3 shrink-0" aria-hidden>
              <circle cx="6" cy="4.5" r="1.75" />
              <circle cx="6" cy="15.5" r="1.75" />
              <circle cx="14" cy="7" r="1.75" />
              <path d="M6 6.25v7.5M14 8.75c0 3-4.5 2.5-7.25 5.25" />
            </svg>
            <span className="truncate">{run.branch}</span>
          </span>
        )}
        <span className="text-zinc-500">
          <Elapsed run={run} />
          {run.costUsd != null ? ` · $${run.costUsd.toFixed(2)}` : ""}
        </span>
        {run.entryId && (
          <Link href={`/entries/${run.entryId}`} className="text-emerald-700 hover:underline dark:text-emerald-400" title="The time entry its time went into">
            booked
          </Link>
        )}
        <span className="ml-auto flex items-center gap-2">
          {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
          {active && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await cancelWorkAction(run.id);
                  setError(r && !r.ok ? (r.error ?? "Couldn't stop it.") : null);
                })
              }
              title={run.status === "queued" ? "Take it out of the queue" : "Stop it — and everything it started"}
            >
              {run.status === "queued" ? "Unqueue" : "Stop"}
            </button>
          )}
        </span>
      </div>
      {open && (
        <div className="space-y-2.5 border-t border-zinc-200 p-2.5 dark:border-zinc-800">
          {run.live && run.status === "running" && <LiveControls run={run} />}
          {run.status !== "queued" && <RunLog id={run.id} />}
          {run.status === "queued" && <p className="text-xs text-zinc-500">Waiting for a free worker.</p>}
          {!active && <RunResult run={run} created={created} />}
        </div>
      )}
    </div>
  );
}
