import type { EntryTypeDef } from "@/lib/entry-types-shared";
import { formatHours } from "@/lib/format";
import type { TicketCard } from "@/lib/jira/ticket-card-shared";
import type { JobLabelSummary, JobReportSummary } from "@/lib/report";
import { TicketLink } from "./TicketLink";
import { TypeBadge } from "./TypeBadge";
import { t } from "@/lib/i18n/server";

/** A label, with its ticket key as a Jira link when the label starts with it ("PROJ-401: …"). */
function Label({ line, tickets }: { line: JobLabelSummary; tickets: Record<string, TicketCard> }) {
  const key = line.ticket?.trim();
  if (key && line.label.toUpperCase().startsWith(key.toUpperCase())) {
    return (
      <>
        <TicketLink ticket={key} card={tickets[key.toUpperCase()]} />
        {line.label.slice(key.length)}
      </>
    );
  }
  return <>{line.label}</>;
}

/** Each job's hours split by report label (as the report rules name the work), most hours first. */
export function JobSummaries({
  jobs,
  total,
  types,
  tickets,
}: {
  jobs: JobReportSummary[];
  total: number;
  types: Record<string, EntryTypeDef>;
  tickets: Record<string, TicketCard>;
}) {
  if (jobs.length === 0) return <p className="py-4 text-center text-sm text-zinc-500">{t("No time booked in this month.")}</p>;
  return (
    <div className="space-y-3">
      {jobs.map((j) => (
        <details key={j.jobNumber} open className="group overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-zinc-50 px-3 py-1.5 text-sm font-semibold hover:bg-zinc-100 dark:bg-zinc-900/60 dark:hover:bg-zinc-800/60 [&::-webkit-details-marker]:hidden">
            <span className="flex min-w-0 items-center gap-2">
              <span className="w-3 text-zinc-400 transition-transform group-open:rotate-90">▸</span>
              <span className="truncate">
                <span className="font-mono">{j.jobNumber}</span> {j.jobName}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-3 tabular-nums">
              <span className="text-xs font-normal text-zinc-400">{total > 0 ? `${Math.round((j.hours / total) * 100)}%` : ""}</span>
              {formatHours(j.hours)} h
            </span>
          </summary>
          <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-zinc-800/60 dark:border-zinc-800">
            {j.lines.map((l) => (
              <li key={l.label} className="flex items-start justify-between gap-3 px-3 py-1.5 text-sm">
                <div className="min-w-0 pl-5">
                  <Label line={l} tickets={tickets} />
                  {l.count > 1 && <span className="ml-1 text-xs text-zinc-400">×{l.count}</span>}
                </div>
                <span className="flex shrink-0 items-center gap-2">
                  <span
                    className="text-xs text-zinc-400 tabular-nums"
                    title={t("{entries} on {days}", {
                      entries: l.count === 1 ? t("1 entry") : t("{n} entries", { n: l.count }),
                      days: l.days === 1 ? t("1 day") : t("{n} days", { n: l.days }),
                    })}
                  >
                    {l.days === 1 ? t("1 day") : t("{n} days", { n: l.days })}
                  </span>
                  <TypeBadge type={l.type} types={types} />
                  <span className="min-w-[7ch] border-l border-zinc-200 pl-2 text-right font-medium tabular-nums dark:border-zinc-700">
                    {formatHours(l.hours)} h
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}
