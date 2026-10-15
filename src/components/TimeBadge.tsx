import { SourceCard } from "./SourceCard";
import type { TimeBrief } from "@/lib/entities-shared";
import { formatDateTime } from "@/lib/format";
import { formatMinutes } from "@/lib/work/shared";
import { useT } from "@/components/I18nProvider";

/** A time record on a todo as a small card: what was done, how long, who; ↗ opens the todo. */
export function TimeBadge({ r, className = "" }: { r: TimeBrief; className?: string }) {
  const t = useT();
  return (
    <SourceCard
      tone="amber"
      icon={
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="10" cy="10" r="6.5" />
          <path d="M10 6.5V10l2.5 1.5" />
        </svg>
      }
      kind={`${t("Time")} ${r.todo}`}
      when={formatDateTime(r.at)}
      title={r.note || r.todo}
      sub={[formatMinutes(r.minutes), r.by].filter(Boolean).join(" · ")}
      href={`/t/${r.todoId}`}
      hrefTitle={t("Open the todo")}
      className={className}
    />
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
