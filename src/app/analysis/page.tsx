import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { BarList, Donut, Legend, LineChart, TYPE_STYLE, WeeklyBars, type BarItem, type LinePoint } from "@/components/charts";
import { getAnalysis, getEarliestEntryDate } from "@/lib/analysis";
import { formatHours } from "@/lib/format";

export const metadata: Metadata = { title: "Analysis" };

const RANGES = [
  { weeks: 4, label: "4 weeks" },
  { weeks: 8, label: "8 weeks" },
  { weeks: 12, label: "12 weeks" },
  { weeks: 26, label: "26 weeks" },
  { weeks: 0, label: "All time" },
];

export default async function AnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ weeks?: string; tickets?: string }>;
}) {
  await connection();
  const sp = await searchParams;
  const weeks = sp.weeks !== undefined && /^\d+$/.test(sp.weeks) ? Number(sp.weeks) : 8;
  const mine = sp.tickets === "mine";
  const a = getAnalysis({ weeks, earliest: getEarliestEntryDate(), ticketScope: mine ? "mine" : "all" });

  const href = (w: number, m = mine) => `/analysis?weeks=${w}${m ? "&tickets=mine" : ""}`;
  const pct = (h: number) => (a.totalHours > 0 ? Math.round((h / a.totalHours) * 100) : 0);

  const tagItems: BarItem[] = a.byTag.slice(0, 12).map((t) => ({
    key: String(t.tag.id),
    label: `#${t.tag.name}`,
    value: t.hours,
    valueLabel: `${formatHours(t.hours)} h`,
    barClass: "bg-teal-500",
  }));
  if (a.untaggedHours > 0) {
    tagItems.push({
      key: "untagged",
      label: "untagged",
      value: a.untaggedHours,
      valueLabel: `${formatHours(a.untaggedHours)} h`,
      barClass: "bg-zinc-300 dark:bg-zinc-600",
    });
  }

  const ticketItems: BarItem[] = a.topTickets.map((t) => ({
    key: t.ticket,
    label: <span className="font-mono">{t.ticket}</span>,
    value: t.hours,
    valueLabel: `${formatHours(t.hours)} h`,
    barClass: "bg-indigo-500",
  }));

  const jobItems: BarItem[] = a.byJob.map((j) => ({
    key: j.jobNumber,
    label: `${j.jobNumber} ${j.jobName}`,
    value: j.hours,
    valueLabel: `${formatHours(j.hours)} h`,
    barClass: "bg-sky-500",
  }));

  const weekColumns = a.weeks.map((w) => ({
    key: w.weekKey,
    label: `W${w.label}`,
    total: w.total,
    segments: [
      { type: "meeting" as const, value: w.byType.meeting },
      { type: "ticket" as const, value: w.byType.ticket },
      { type: "other" as const, value: w.byType.other },
    ],
    badge: a.jira
      ? w.closed
        ? `${w.closed}✓`
        : undefined
      : w.ticketsWorked
        ? `${w.ticketsWorked}🎫`
        : undefined,
  }));

  const performancePoints: LinePoint[] = a.weeks.map((w) => ({ label: `W${w.label}`, value: w.avgResolutionDays }));
  const parallelPoints: LinePoint[] = a.weeks.map((w) => ({ label: `W${w.label}`, value: w.wip }));
  const days = (v: number | null) => (v === null ? "—" : `${formatHours(v)} d`);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Analysis</h1>
          <p className="text-sm text-zinc-500">
            {a.range.allTime ? "All recorded time" : `Last ${a.range.weeks} weeks`} · {a.range.fromIso} → {a.range.toIso}
            {a.jira &&
              (a.myTickets
                ? ` · Jira metrics: ${a.myTickets.worked} ticket${a.myTickets.worked === 1 ? "" : "s"} you worked on${
                    a.myTickets.inJira < a.myTickets.worked ? ` (${a.myTickets.inJira} in Jira)` : ""
                  }`
                : " · Jira metrics: all tickets")}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-1" title="Jira metrics for everyone's tickets, or only the tickets you booked time on in this range">
            <Link href={href(weeks, false)} className={`btn btn-sm ${mine ? "" : "btn-primary"}`}>
              Everyone
            </Link>
            <Link href={href(weeks, true)} className={`btn btn-sm ${mine ? "btn-primary" : ""}`}>
              Mine
            </Link>
          </div>
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <Link key={r.weeks} href={href(r.weeks)} className={`btn btn-sm ${weeks === r.weeks ? "btn-primary" : ""}`}>
                {r.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {!a.hasData ? (
        <p className="card p-6 text-center text-sm text-zinc-500">No time booked in this range.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Total booked" value={`${formatHours(a.totalHours)} h`} />
            <Stat label="Meetings" value={`${a.meetingPercent}%`} tone="violet" />
            <Stat label="Avg meetings / day" value={`${formatHours(a.avgMeetingHoursPerActiveDay)} h`} tone="violet" />
            <Stat label="Distinct tickets" value={String(a.distinctTickets)} />
            <Stat label="Avg / active week" value={`${formatHours(a.avgHoursPerActiveWeek)} h`} />
          </div>

          {a.jira && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label={a.myTickets ? "Worked on" : "Jira tickets"}
                value={String(a.jira.total)}
                hint={a.myTickets ? "Synced Jira tickets you booked time on in this range." : "All synced tickets on enabled boards, plus yours."}
              />
              <Stat label="Open" value={String(a.jira.byCategory.todo + a.jira.byCategory.inprogress)} />
              <Stat label="Done" value={String(a.jira.byCategory.done)} tone="violet" />
              <Stat label="Closed in range" value={String(a.ticketsClosed)} tone="violet" />
            </div>
          )}

          {a.jira && a.hasTicketDates && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Avg reaction time"
                value={a.hasReactionData ? days(a.avgReactionDays) : "—"}
                tone="sky"
                hint="Time to respond: ticket opened → first status change (Jira changelog)."
              />
              <Stat
                label="Avg resolution time"
                value={days(a.avgResolutionDays)}
                tone="indigo"
                hint="Ticket opened → resolved, averaged over tickets resolved in range."
              />
              <Stat label="Avg closed / week" value={formatHours(a.avgClosedPerWeek)} tone="indigo" />
              <Stat label="Avg parallel tickets" value={formatHours(a.avgParallelPerWeek)} tone="amber" />
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card p-4">
              <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">Time split by type</h2>
              <div className="flex items-center gap-6">
                <Donut
                  centerValue={`${a.meetingPercent}%`}
                  centerLabel="Meetings"
                  segments={[
                    { key: "meeting", value: a.byType.meeting, strokeClass: TYPE_STYLE.meeting.stroke },
                    { key: "ticket", value: a.byType.ticket, strokeClass: TYPE_STYLE.ticket.stroke },
                    { key: "other", value: a.byType.other, strokeClass: TYPE_STYLE.other.stroke },
                  ]}
                />
                <div className="space-y-2">
                  {(["meeting", "ticket", "other"] as const).map((t) => (
                    <div key={t} className="flex items-center gap-2 text-sm">
                      <span className={`inline-block size-2.5 rounded-sm ${TYPE_STYLE[t].dot}`} />
                      <span className="w-20">{TYPE_STYLE[t].label}</span>
                      <span className="font-medium tabular-nums">{formatHours(a.byType[t])} h</span>
                      <span className="text-zinc-500 tabular-nums">{pct(a.byType[t])}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="card p-4">
              <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">Hours by job</h2>
              <BarList items={jobItems} />
            </section>
          </div>

          <section className="card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-zinc-500 uppercase">Weekly hours &amp; tickets</h2>
              <Legend
                items={[
                  { dot: TYPE_STYLE.meeting.dot, label: "Meetings" },
                  { dot: TYPE_STYLE.ticket.dot, label: "Tickets" },
                  { dot: TYPE_STYLE.other.dot, label: "Other" },
                  a.jira
                    ? { dot: "bg-emerald-400", label: "✓ tickets closed" }
                    : { dot: "bg-sky-400", label: "🎫 tickets worked" },
                ]}
              />
            </div>
            <WeeklyBars weeks={weekColumns} />
          </section>

          {a.jira && a.hasTicketDates && (
            <div className="grid gap-4 lg:grid-cols-2">
              <section className="card p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-zinc-500 uppercase">Performance</h2>
                  <span className="text-xs text-zinc-500">resolution time · lower is better</span>
                </div>
                <LineChart points={performancePoints} colorClass="text-indigo-500" unit=" d" empty="No tickets closed in range." />
                <p className="mt-2 text-xs text-zinc-400">Avg days from a ticket opening to its resolution, by the week it was resolved.</p>
              </section>
              <section className="card p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-zinc-500 uppercase">Parallelism</h2>
                  <span className="text-xs text-zinc-500">tickets open at once</span>
                </div>
                <LineChart points={parallelPoints} colorClass="text-amber-500" empty="No open tickets." />
                <p className="mt-2 text-xs text-zinc-400">Number of tickets in flight (opened but not yet resolved) during each week.</p>
              </section>
            </div>
          )}

          {a.jira && !a.hasTicketDates && (
            <p className="card p-4 text-sm text-zinc-500">
              Reaction time and parallelism need ticket <em>opened</em> dates. Re-sync on the Jira tab to backfill them.
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card p-4">
              <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">Hours by tag</h2>
              <BarList items={tagItems} empty="No tagged entries." />
            </section>
            <section className="card p-4">
              <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">Top tickets by hours</h2>
              <BarList items={ticketItems} empty="No tickets." />
            </section>
          </div>

          <p className="text-xs text-zinc-400">
            {a.jira
              ? "“Tickets closed” buckets synced Jira tickets by their resolution date; some done tickets have no resolution date and aren't counted per week. Sync tickets on the Jira tab."
              : "“Tickets worked” counts distinct ticket keys booked in a week (activity, not closures). Sync Jira on the Jira tab to track actual closures."}
          </p>
        </>
      )}
    </div>
  );
}

const STAT_TONE = {
  violet: "text-violet-600 dark:text-violet-400",
  indigo: "text-indigo-600 dark:text-indigo-400",
  amber: "text-amber-600 dark:text-amber-400",
  sky: "text-sky-600 dark:text-sky-400",
} as const;

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: keyof typeof STAT_TONE;
  hint?: string;
}) {
  return (
    <div className="card px-4 py-3" title={hint}>
      <div className="flex items-center gap-1 text-xs font-medium text-zinc-500 uppercase">
        {label}
        {hint && <span className="text-zinc-400" aria-hidden>ⓘ</span>}
      </div>
      <div className={`text-2xl font-semibold tabular-nums ${tone ? STAT_TONE[tone] : ""}`}>{value}</div>
    </div>
  );
}
