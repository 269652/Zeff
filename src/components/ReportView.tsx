"use client";

import { useState } from "react";
import { formatHours } from "@/lib/format";
import type { ReportLine, RewrittenReport } from "@/lib/report";
import type { TagLite } from "@/lib/tags-shared";
import { formatDay } from "@/lib/week";
import { CopyButton } from "./CopyButton";

function Chips({ tags }: { tags: TagLite[] }) {
  if (tags.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap justify-end gap-1">
      {tags.map((t) => (
        <span key={t.id} className="badge badge-tag">#{t.name}</span>
      ))}
    </span>
  );
}

function Line({ line }: { line: ReportLine }) {
  const [open, setOpen] = useState(false);
  const expandable = line.expandable;

  return (
    <li className="text-sm">
      <div
        className={`flex items-start justify-between gap-3 px-3 py-1.5 ${expandable ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40" : ""}`}
        onClick={expandable ? () => setOpen((o) => !o) : undefined}
      >
        <span className="min-w-0">
          {expandable && <span className="mr-1 inline-block w-3 text-zinc-400">{open ? "▾" : "▸"}</span>}
          {line.label}
          {line.count > 1 && <span className="ml-1 text-xs text-zinc-400">×{line.count}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <Chips tags={line.tags} />
          <span className={`badge badge-${line.type}`}>{line.type}</span>
          <span className="tabular-nums font-medium">{formatHours(line.hours)} h</span>
        </span>
      </div>

      {expandable && open && (
        <ul className="border-t border-dashed border-zinc-100 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/40">
          {line.entries.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-3 py-1 pr-3 pl-10 text-xs">
              <span className="min-w-0 text-zinc-600 dark:text-zinc-300">
                {e.ticket && <span className="mr-1 font-mono text-zinc-400">{e.ticket}</span>}
                {e.description}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Chips tags={e.tags} />
                <span className="tabular-nums text-zinc-500">{formatHours(e.hours)} h</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function ReportView({ report, text, today }: { report: RewrittenReport; text: string; today?: string }) {
  const [openDays, setOpenDays] = useState<Set<string>>(
    () => new Set(report.days.filter((d) => d.date === today).map((d) => d.date)),
  );
  const toggleDay = (date: string) =>
    setOpenDays((s) => {
      const next = new Set(s);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });

  if (report.days.length === 0) {
    return <p className="py-4 text-center text-sm text-zinc-500">No time booked in this week.</p>;
  }
  const groupLabel = "rewritten by your report rules";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-zinc-500">
          {groupLabel}
          {report.filter.reportedBy ? ` · ${report.filter.reportedBy}` : ""}
        </div>
        <CopyButton text={text} label="Copy report" />
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
                className={`flex w-full items-center justify-between bg-zinc-50 px-3 py-1.5 text-sm font-semibold hover:bg-zinc-100 dark:bg-zinc-900/60 dark:hover:bg-zinc-800/60 ${open ? "border-b border-zinc-100 dark:border-zinc-800" : ""}`}
              >
                <span className="flex items-center gap-2">
                  <span className="w-3 text-zinc-400">{open ? "▾" : "▸"}</span>
                  {formatDay(new Date(day.date + "T00:00:00"), "EEEE, d MMM")}
                  {!open && <span className="text-xs font-normal text-zinc-400">· {day.lines.length} lines</span>}
                </span>
                <span className="tabular-nums">{formatHours(day.total)} h</span>
              </button>
              {open && (
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                  {day.lines.map((l) => (
                    <Line key={l.key} line={l} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between border-t border-zinc-200 pt-2 text-sm font-semibold dark:border-zinc-800">
        <span>Total</span>
        <span className="tabular-nums">{formatHours(report.total)} h</span>
      </div>
    </div>
  );
}
