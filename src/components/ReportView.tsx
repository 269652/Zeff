"use client";

import { EmptyState } from "@/components/EmptyState";
import { useMemo, useState } from "react";
import { typeMapOf, type EntryTypeDef } from "@/lib/entry-types-shared";
import type { TicketCard } from "@/lib/jira/ticket-card-shared";
import { formatHours, round2 } from "@/lib/format";
import type { ReportLine, ReportLineEntry, RewrittenReport } from "@/lib/report";
import { isOpen, rememberOpen, uiKey, type UiOpenState } from "@/lib/ui-state-shared";
import { formatDay } from "@/lib/week";
import { CopyButton } from "./CopyButton";
import { TicketLink } from "./TicketLink";
import { TypeBadge } from "./TypeBadge";
import { useT } from "@/components/I18nProvider";

function EntryRow({ e, nested, tickets }: { e: ReportLineEntry; nested?: boolean; tickets: Record<string, TicketCard> }) {
  return (
    <li className={`flex items-start justify-between gap-3 py-1 pr-3 text-xs ${nested ? "pl-14" : "pl-10"}`}>
      <div className="min-w-0 text-zinc-600 dark:text-zinc-300">
        {e.ticket && (
          <span className="mr-1 text-zinc-400">
            <TicketLink ticket={e.ticket} card={tickets[e.ticket.toUpperCase()]} />
          </span>
        )}
        {e.description}
      </div>
      <span className="min-w-[7ch] shrink-0 border-l border-zinc-200 pl-2 text-right tabular-nums text-zinc-500 dark:border-zinc-700">{formatHours(e.hours)} h</span>
    </li>
  );
}

/** A line's entries grouped by job ("JobNr: JobName"), in job-number order. */
function groupByJob(entries: ReportLineEntry[]) {
  const groups = new Map<string, { jobNumber: string; jobName: string; hours: number; entries: ReportLineEntry[] }>();
  for (const e of entries) {
    const g = groups.get(e.jobNumber) ?? { jobNumber: e.jobNumber, jobName: e.jobName, hours: 0, entries: [] };
    g.hours = round2(g.hours + e.hours);
    g.entries.push(e);
    groups.set(e.jobNumber, g);
  }
  return [...groups.values()].sort((a, b) => a.jobNumber.localeCompare(b.jobNumber, undefined, { numeric: true }));
}

function Line({
  line,
  date,
  ui,
  types,
  tickets,
}: {
  line: ReportLine;
  date: string;
  ui: UiOpenState;
  types: Record<string, EntryTypeDef>;
  tickets: Record<string, TicketCard>;
}) {
  const stateKey = uiKey.line(date, line.key);
  const [open, setOpen] = useState(() => isOpen(ui, stateKey));
  const expandable = line.expandable;
  const toggle = () => {
    setOpen(!open);
    rememberOpen(stateKey, !open);
  };
  // Meetings (one line across jobs) always show their job groups; other lines only when they span jobs.
  const groups = groupByJob(line.entries);
  const grouped = line.type === "meeting" || groups.length > 1;

  return (
    <li className="text-sm">
      <div
        className={`flex items-start justify-between gap-3 px-3 py-1.5 ${expandable ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40" : ""}`}
        onClick={expandable ? toggle : undefined}
      >
        <div className="min-w-0">
          {expandable && <span className="mr-1 inline-block w-3 text-zinc-400">{open ? "▾" : "▸"}</span>}
          {line.label}
          {line.count > 1 && <span className="ml-1 text-xs text-zinc-400">×{line.count}</span>}
        </div>
        <span className="flex shrink-0 items-center gap-2">
          <TypeBadge type={line.type} types={types} />
          <span className="min-w-[7ch] border-l border-zinc-200 pl-2 text-right font-medium tabular-nums dark:border-zinc-700">{formatHours(line.hours)} h</span>
        </span>
      </div>

      {expandable && open && (
        <ul className="border-t border-dashed border-zinc-100 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/40">
          {grouped
            ? groups.map((g) => (
                <li key={g.jobNumber}>
                  <div className="flex items-start justify-between gap-3 pt-1.5 pr-3 pb-0.5 pl-10 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    <span className="min-w-0">
                      <span className="font-mono">{g.jobNumber}</span>: {g.jobName}
                    </span>
                    <span className="min-w-[7ch] shrink-0 border-l border-zinc-200 pl-2 text-right tabular-nums dark:border-zinc-700">{formatHours(g.hours)} h</span>
                  </div>
                  <ul>
                    {g.entries.map((e) => (
                      <EntryRow key={e.id} e={e} nested tickets={tickets} />
                    ))}
                  </ul>
                </li>
              ))
            : line.entries.map((e) => <EntryRow key={e.id} e={e} tickets={tickets} />)}
        </ul>
      )}
    </li>
  );
}

export function ReportView({
  report,
  text,
  today,
  ui,
  types,
  ticketCards,
}: {
  report: RewrittenReport;
  text: string;
  today?: string;
  /** Remembered open/closed days and lines (today's day is open by default). */
  ui: UiOpenState;
  /** The configured entry types (names and colors of the line badges). */
  types: EntryTypeDef[];
  /** Hover cards for the tickets in the report (by upper-case key). */
  ticketCards: Record<string, TicketCard>;
}) {
  const t = useT();
  const typeMap = useMemo(() => typeMapOf(types), [types]);
  const [openDays, setOpenDays] = useState<Set<string>>(
    () => new Set(report.days.filter((d) => isOpen(ui, uiKey.day(d.date), d.date === today)).map((d) => d.date)),
  );
  const toggleDay = (date: string) => {
    const open = !openDays.has(date);
    setOpenDays((s) => {
      const next = new Set(s);
      if (open) next.add(date);
      else next.delete(date);
      return next;
    });
    rememberOpen(uiKey.day(date), open, date === today);
  };

  if (report.days.length === 0) {
    return <EmptyState variant="centered">{t("No time booked in this week.")}</EmptyState>;
  }
  const groupLabel = t("rewritten by your report rules");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-zinc-500">
          {groupLabel}
          {report.filter.reportedBy ? ` · ${report.filter.reportedBy}` : ""}
        </div>
        <CopyButton text={text} label={t("Copy report")} />
      </div>

      <div className="space-y-3">
        {report.days.map((day) => {
          const open = openDays.has(day.date);
          return (
            <div key={day.date} className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => toggleDay(day.date)}
                aria-expanded={open}
                className={`flex w-full cursor-pointer items-center justify-between bg-zinc-50 px-3 py-1.5 text-sm font-semibold hover:bg-zinc-100 dark:bg-zinc-900/60 dark:hover:bg-zinc-800/60 ${open ? "border-b border-zinc-100 dark:border-zinc-800" : ""}`}
              >
                <span className="flex items-center gap-2">
                  <span className="w-3 text-zinc-400">{open ? "▾" : "▸"}</span>
                  {formatDay(new Date(day.date + "T00:00:00"), "EEEE, d MMM")}
                  {!open && <span className="text-xs font-normal text-zinc-400">· {day.lines.length === 1 ? t("1 line") : t("{n} lines", { n: day.lines.length })}</span>}
                </span>
                <span className="tabular-nums">{formatHours(day.total)} h</span>
              </button>
              {open && (
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                  {day.lines.map((l) => (
                    <Line key={l.key} line={l} date={day.date} ui={ui} types={typeMap} tickets={ticketCards} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between border-t border-zinc-200 pt-2 text-sm font-semibold dark:border-zinc-800">
        <span>{t("Total")}</span>
        <span className="tabular-nums">{formatHours(report.total)} h</span>
      </div>
    </div>
  );
}
