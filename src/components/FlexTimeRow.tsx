"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { bookFlexTimeAction } from "@/app/actions";
import { formatHours, round2 } from "@/lib/format";

/** A shadow value that books itself: dashed, greyed out, indigo on hover. */
const GHOST =
  "cursor-pointer rounded border border-dashed border-zinc-300 px-1.5 font-semibold text-zinc-400 transition hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-600 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-500 dark:hover:border-indigo-500 dark:hover:bg-indigo-950/50 dark:hover:text-indigo-300";

export type FlexTimeDay = {
  iso: string;
  /** "Tue 22 Sep", for titles. */
  label: string;
  /** Missing hours (0 = nothing to offer: full, off, or still ahead). */
  gap: number;
  /** The day column's own look (today, days off). */
  className: string;
};

/**
 * The weekly table's flex-time (Gleitzeit) row: a shadow under the booked jobs, offering each
 * day that isn't fully booked its missing hours. A day's + books them on the flex-time job with
 * its comment; the total books every day at once. The server works the gaps out again, so a
 * double click or a stale page books nothing twice.
 */
export function FlexTimeRow({
  job,
  comment,
  days,
}: {
  job: { id: number; number: string; name: string };
  comment: string;
  days: FlexTimeDay[];
}) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = days.filter((d) => d.gap > 0);
  const total = round2(open.reduce((a, d) => a + d.gap, 0));
  const dashed = "border-t border-dashed border-t-zinc-300 dark:border-t-zinc-700";

  const book = (dates: string[], key: string) => {
    setBusy(key);
    setError(null);
    startTransition(async () => {
      const r = await bookFlexTimeAction(dates);
      if (!r?.ok) setError(r?.error ?? "Couldn't book the flex time.");
      setBusy(null);
    });
  };

  return (
    <tr className="text-zinc-400 dark:text-zinc-500">
      <td className={dashed}>
        <Link href={`/jobs/${job.id}`} className="italic hover:underline" title="The flex-time job (Schedule → Flex time)">
          <span className="font-mono whitespace-nowrap">{job.number}</span> {job.name}
        </Link>
        <div className="text-xs">Flex time · “{comment}”</div>
        {error && (
          <div className="mt-0.5 text-xs text-red-600 dark:text-red-400" role="alert">
            {error}
          </div>
        )}
      </td>
      {days.map((d) => (
        <td key={d.iso} className={`${d.className} ${dashed}`}>
          {d.gap > 0 && (
            <button
              type="button"
              className={GHOST}
              disabled={pending}
              onClick={() => book([d.iso], d.iso)}
              title={`Book the missing ${formatHours(d.gap)} h on ${job.number} as “${comment}” for ${d.label}`}
              aria-label={`Book ${formatHours(d.gap)} hours flex time on ${d.label}`}
            >
              {busy === d.iso ? "…" : `+${formatHours(d.gap)}`}
            </button>
          )}
        </td>
      ))}
      <td className={`num ${dashed}`}>
        {open.length > 1 ? (
          <button
            type="button"
            className={GHOST}
            disabled={pending}
            onClick={() => book(open.map((d) => d.iso), "all")}
            title={`Book the missing hours of all ${open.length} days (${formatHours(total)} h) on ${job.number} as “${comment}”`}
            aria-label={`Book ${formatHours(total)} hours flex time on all ${open.length} days`}
          >
            {busy === "all" ? "…" : `+${formatHours(total)}`}
          </button>
        ) : (
          total > 0 && `+${formatHours(total)}`
        )}
      </td>
    </tr>
  );
}
