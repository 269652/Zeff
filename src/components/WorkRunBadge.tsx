import Link from "next/link";
import type { WorkRunBrief } from "@/lib/entities-shared";
import { SparkIcon } from "./icons";
import { SourceCard } from "./SourceCard";
import { formatDateTime, formatTime } from "@/lib/format";
import { useT } from "@/components/I18nProvider";
import { rich } from "@/lib/i18n/rich";
import type { T } from "@/lib/i18n/shared";

const when = (iso: string | null) => (iso ? formatDateTime(iso) : "?");
const time = (iso: string | null) => (iso ? formatTime(iso) : "…");

const CARD = "space-y-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900";
const outcomes = (t: T): Record<string, string> => ({ done: t("done"), partial: t("partly"), blocked: t("blocked") });

/** A run (an agent's, a worker's) as a small card: what it did, who, when, how long, how it ended. With `onToggle` it unfolds. */
export function WorkRunBadge({ r, className = "", expanded = false, onToggle }: { r: WorkRunBrief; className?: string; expanded?: boolean; onToggle?: () => void }) {
  const t = useT();
  const OUTCOME = outcomes(t);
  const end = r.outcome ? (OUTCOME[r.outcome] ?? r.outcome) : r.status;
  const summary = r.summary?.replace(/\s+/g, " ").trim();
  return (
    <SourceCard
      tone="violet"
      icon={<SparkIcon />}
      kind={t("Run {ref}", { ref: r.ref })}
      state={end ? { text: end, className: r.outcome === "blocked" ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200" : undefined } : undefined}
      when={r.startedAt ? formatDateTime(r.startedAt) : undefined}
      title={r.entryLine || summary || r.ref}
      sub={[r.agent, r.minutes != null ? `${r.minutes} min` : ""].filter(Boolean).join(" · ")}
      snippet={r.entryLine ? summary : undefined}
      expanded={expanded}
      onToggle={onToggle}
      toggleTitle={expanded ? t("Fold") : t("Show the report")}
      href={`/work?run=${r.id}`}
      hrefTitle={t("Open the run on the Code tab")}
      className={className}
    />
  );
}

/** A run in full: who, from when to when, how it ended, its line for the booking and its report. */
export function WorkRunDetails({ r }: { r: WorkRunBrief }) {
  const t = useT();
  const OUTCOME = outcomes(t);
  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
        <span>
          {r.ref} · {r.agent}
          {r.todoId ? (
            <>
              {" "}
              {rich(t("on <link>T-{id}</link>", { id: r.todoId }), {
                link: (s) => (
                  <Link href={`/t/${r.todoId}`} className="font-mono text-indigo-600 hover:underline dark:text-indigo-400">
                    {s}
                  </Link>
                ),
              })}
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
