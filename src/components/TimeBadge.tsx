import Link from "next/link";
import type { TimeBrief } from "@/lib/entities-shared";
import { formatDateTime } from "@/lib/format";
import { formatMinutes } from "@/lib/work/shared";
import { useT } from "@/components/I18nProvider";

const BADGE = "flex min-w-0 items-stretch overflow-hidden rounded-md border border-violet-200 bg-violet-50 text-xs text-violet-950 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-100";

/** A time record on a todo as a badge: "T-12 · 45 min · what was done — who"; ↗ opens the todo. */
export function TimeBadge({ r, className = "" }: { r: TimeBrief; className?: string }) {
  const t = useT();
  return (
    <div className={`${BADGE} ${className}`}>
      <span className="flex min-w-0 flex-1 items-center gap-2 py-1 pr-2 pl-2">
        <span className="shrink-0 font-mono font-medium">{r.todo}</span>
        <span className="shrink-0 text-violet-700/80 dark:text-violet-300/80">{formatMinutes(r.minutes)}</span>
        {r.note && <span className="min-w-0 truncate text-violet-900/70 dark:text-violet-100/70">{r.note}</span>}
        <span className="shrink-0 text-violet-700/80 dark:text-violet-300/80">— {r.by}</span>
      </span>
      <Link href={`/t/${r.todoId}`} className="flex shrink-0 items-center px-2 text-violet-700 transition hover:bg-violet-100 dark:text-violet-300 dark:hover:bg-violet-950" title={t("Open the todo")}>
        ↗
      </Link>
    </div>
  );
}

/** A time record in full. */
export function TimeDetails({ r }: { r: TimeBrief }) {
  return (
    <div className="space-y-1 rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap justify-between gap-2 text-xs text-zinc-500">
        <span>
          {r.todo} · {r.ticket} · {r.by}
        </span>
        <span>
          {formatDateTime(r.at)} · {formatMinutes(r.minutes)}
        </span>
      </div>
      {r.note && <p className="text-zinc-800 dark:text-zinc-100">{r.note}</p>}
    </div>
  );
}
