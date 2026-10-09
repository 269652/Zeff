import Link from "next/link";
import type { WorkRunBrief } from "@/lib/entities-shared";
import { ChevronIcon, SparkIcon } from "./icons";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "?");
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "…");

const CARD = "space-y-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900";
const INNER = "flex min-w-0 flex-1 items-center gap-2 py-1 pr-2 pl-1.5 text-left";
const BADGE = "flex min-w-0 items-stretch overflow-hidden rounded-md border border-violet-200 bg-violet-50 text-xs text-violet-950 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-100";

const OUTCOME: Record<string, string> = { done: "fertig", partial: "teilweise", blocked: "blockiert" };

/** A run (an agent's, a worker's) as a badge: who, when, how long, its line. With `onToggle` it unfolds. */
export function WorkRunBadge({ r, className = "", expanded = false, onToggle }: { r: WorkRunBrief; className?: string; expanded?: boolean; onToggle?: () => void }) {
  const body = (
    <>
      {onToggle && <ChevronIcon open={expanded} className="size-3.5 shrink-0 text-violet-500 dark:text-violet-400" />}
      <SparkIcon className="size-4 shrink-0 text-violet-600 dark:text-violet-400" />
      <span className="shrink-0 font-medium">
        {r.ref} · {r.agent}
      </span>
      <span className="shrink-0 text-violet-700/80 dark:text-violet-300/80">
        {when(r.startedAt)}
        {r.minutes != null ? ` · ${r.minutes} min` : ""}
        {r.outcome ? ` · ${OUTCOME[r.outcome] ?? r.outcome}` : ""}
      </span>
      {r.entryLine && <span className="min-w-0 truncate text-violet-900/70 dark:text-violet-100/70">{r.entryLine}</span>}
    </>
  );
  return (
    <div className={`${BADGE} ${className}`}>
      {onToggle ? (
        <button type="button" className={`${INNER} cursor-pointer transition hover:bg-violet-100 dark:hover:bg-violet-950`} onClick={onToggle} aria-expanded={expanded} title={expanded ? "Fold" : "Den Bericht zeigen"}>
          {body}
        </button>
      ) : (
        <span className={INNER}>{body}</span>
      )}
      <Link href={`/work#w-${r.id}`} className="flex shrink-0 items-center px-2 text-violet-700 transition hover:bg-violet-100 dark:text-violet-300 dark:hover:bg-violet-950" title="Den Lauf auf dem Work-Tab öffnen">
        ↗
      </Link>
    </div>
  );
}

/** A run in full: who, from when to when, how it ended, its line for the booking and its report. */
export function WorkRunDetails({ r }: { r: WorkRunBrief }) {
  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
        <span>
          {r.ref} · {r.agent}
          {r.todoId ? (
            <>
              {" "}
              an{" "}
              <Link href={`/t/${r.todoId}`} className="font-mono text-indigo-600 hover:underline dark:text-indigo-400">
                T-{r.todoId}
              </Link>
            </>
          ) : null}{" "}
          · {r.ticket}
        </span>
        <span>
          {when(r.startedAt)}–{time(r.finishedAt)}
          {r.minutes != null ? ` · ${r.minutes} min` : ""}
          {r.outcome ? ` · ${OUTCOME[r.outcome] ?? r.outcome}` : ""}
        </span>
      </div>
      {r.entryLine && <p className="font-medium text-zinc-800 dark:text-zinc-100">{r.entryLine}</p>}
      {r.summary && <p className="leading-relaxed whitespace-pre-line text-zinc-700 dark:text-zinc-300">{r.summary}</p>}
      {r.branch && <p className="font-mono text-xs text-zinc-500">{r.branch}</p>}
    </div>
  );
}
