import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { rich } from "@/lib/i18n/rich";
import Link from "next/link";
import { connection } from "next/server";
import { BarList, Donut, Legend, LineChart, WeeklyBars, type BarItem, type LinePoint } from "@/components/charts";
import { LinkSelect } from "@/components/LinkSelect";
import { TicketLink } from "@/components/TicketLink";
import { getAnalysis, getEarliestEntryDate } from "@/lib/analysis";
import { listEntryTypes } from "@/lib/entry-types";
import { getTicketCards } from "@/lib/jira/store";
import { FALLBACK_TYPE_COLOR } from "@/lib/entry-types-shared";
import { formatHours } from "@/lib/format";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Analysis") };
}

const ranges = () => [
  { weeks: 4, label: t("4 weeks") },
  { weeks: 8, label: t("8 weeks") },
  { weeks: 12, label: t("12 weeks") },
  { weeks: 26, label: t("26 weeks") },
  { weeks: 0, label: t("All time") },
];

export default async function AnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ weeks?: string; tickets?: string; split?: string }>;
}) {
  await connection();
  if (!isInstalled("zeiterfassung")) return <PluginNotInstalled id="zeiterfassung" />;
  const sp = await searchParams;
  const weeks = sp.weeks !== undefined && /^\d+$/.test(sp.weeks) ? Number(sp.weeks) : 8;
  const mine = sp.tickets === "mine";
  // The "Hours by …" panel: by tag (default) or by type.
  const split = sp.split === "type" ? "type" : "tag";
  const a = getAnalysis({ weeks, earliest: getEarliestEntryDate(), ticketScope: mine ? "mine" : "all" });

  const href = (w: number, m = mine, s = split) => `/analysis?weeks=${w}${m ? "&tickets=mine" : ""}${s === "type" ? "&split=type" : ""}`;

  // Entry types in their configured order and colors; keys with hours but no type (deleted) go last, in grey.
  const configured = listEntryTypes();
  const known = new Set(configured.map((x) => x.key));
  const types = [
    ...configured,
    ...Object.keys(a.byType)
      .filter((k) => !known.has(k))
      .map((k) => ({ key: k, label: k, color: FALLBACK_TYPE_COLOR, builtin: false })),
  ];
  const typesWithHours = types.filter((x) => (a.byType[x.key] ?? 0) > 0);
  const typeItems: BarItem[] = [...typesWithHours]
    .sort((x, y) => (a.byType[y.key] ?? 0) - (a.byType[x.key] ?? 0))
    .map((x) => ({
      key: x.key,
      label: x.label,
      value: a.byType[x.key] ?? 0,
      valueLabel: `${formatHours(a.byType[x.key] ?? 0)} h`,
      color: x.color,
    }));
  const pct = (h: number) => (a.totalHours > 0 ? Math.round((h / a.totalHours) * 100) : 0);

  const tagItems: BarItem[] = a.byTag.slice(0, 12).map((x) => ({
    key: String(x.tag.id),
    label: `#${x.tag.name}`,
    value: x.hours,
    valueLabel: `${formatHours(x.hours)} h`,
    barClass: "bg-teal-500",
  }));
  if (a.untaggedHours > 0) {
    tagItems.push({
      key: "untagged",
      label: t("untagged"),
      value: a.untaggedHours,
      valueLabel: `${formatHours(a.untaggedHours)} h`,
      barClass: "bg-zinc-300 dark:bg-zinc-600",
    });
  }

  const ticketCards = getTicketCards(a.topTickets.map((x) => x.ticket));
  const ticketItems: BarItem[] = a.topTickets.map((x) => ({
    key: x.ticket,
    label: <TicketLink ticket={x.ticket} card={ticketCards[x.ticket.toUpperCase()]} />,
    value: x.hours,
    valueLabel: `${formatHours(x.hours)} h`,
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
    segments: typesWithHours.map((x) => ({ key: x.key, label: x.label, value: w.byType[x.key] ?? 0, color: x.color })),
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
    <div className="page">
      <div className="page-aside">
        <div>
          <h1 className="text-lg font-semibold">{t("Analysis")}</h1>
          <p className="text-sm text-zinc-500">
            {a.range.allTime ? t("All recorded time") : t("Last {n} weeks", { n: a.range.weeks })} · {a.range.fromIso} → {a.range.toIso}
            {a.jira &&
              (a.myTickets
                ? ` · ${
                    a.myTickets.worked === 1
                      ? t("Jira metrics: 1 ticket you worked on")
                      : t("Jira metrics: {n} tickets you worked on", { n: a.myTickets.worked })
                  }${a.myTickets.inJira < a.myTickets.worked ? ` ${t("({n} in Jira)", { n: a.myTickets.inJira })}` : ""}`
                : ` · ${t("Jira metrics: all tickets")}`)}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-1" title={t("Jira metrics for everyone's tickets, or only the tickets you booked time on in this range")}>
            <Link href={href(weeks, false)} className={`btn btn-sm ${mine ? "" : "btn-primary"}`}>
              {t("Everyone")}
            </Link>
            <Link href={href(weeks, true)} className={`btn btn-sm ${mine ? "btn-primary" : ""}`}>
              {t("Mine")}
            </Link>
          </div>
          <div className="flex gap-1">
            {ranges().map((r) => (
              <Link key={r.weeks} href={href(r.weeks)} className={`btn btn-sm ${weeks === r.weeks ? "btn-primary" : ""}`}>
                {r.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {!a.hasData ? (
        <p className="card p-6 text-center text-sm text-zinc-500">{t("No time booked in this range.")}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label={t("Total booked")} value={`${formatHours(a.totalHours)} h`} />
            <Stat label={t("Meetings")} value={`${a.meetingPercent}%`} tone="violet" />
            <Stat label={t("Avg meetings / day")} value={`${formatHours(a.avgMeetingHoursPerActiveDay)} h`} tone="violet" />
            <Stat label={t("Distinct tickets")} value={String(a.distinctTickets)} />
            <Stat label={t("Avg / active week")} value={`${formatHours(a.avgHoursPerActiveWeek)} h`} />
          </div>

          {a.jira && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label={a.myTickets ? t("Worked on") : t("Jira tickets")}
                value={String(a.jira.total)}
                hint={a.myTickets ? t("Synced Jira tickets you booked time on in this range.") : t("All synced tickets on enabled boards, plus yours.")}
              />
              <Stat label={t("Open")} value={String(a.jira.byCategory.todo + a.jira.byCategory.inprogress)} />
              <Stat label={t("Done")} value={String(a.jira.byCategory.done)} tone="violet" />
              <Stat label={t("Closed in range")} value={String(a.ticketsClosed)} tone="violet" />
            </div>
          )}

          {a.jira && a.hasTicketDates && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label={t("Avg reaction time")}
                value={a.hasReactionData ? days(a.avgReactionDays) : "—"}
                tone="sky"
                hint={t("Time to respond: ticket opened → first status change (Jira changelog).")}
              />
              <Stat
                label={t("Avg resolution time")}
                value={days(a.avgResolutionDays)}
                tone="indigo"
                hint={t("Ticket opened → resolved, averaged over tickets resolved in range.")}
              />
              <Stat label={t("Avg closed / week")} value={formatHours(a.avgClosedPerWeek)} tone="indigo" />
              <Stat label={t("Avg parallel tickets")} value={formatHours(a.avgParallelPerWeek)} tone="amber" />
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card p-4">
              <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">{t("Time split by type")}</h2>
              <div className="flex items-center gap-6">
                <Donut
                  centerValue={`${a.meetingPercent}%`}
                  centerLabel={t("Meetings")}
                  segments={typesWithHours.map((x) => ({ key: x.key, value: a.byType[x.key] ?? 0, color: x.color }))}
                />
                <div className="space-y-2">
                  {typesWithHours.map((x) => (
                    <div key={x.key} className="flex items-center gap-2 text-sm">
                      <span className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: x.color }} />
                      <span className="w-20 truncate" title={x.label}>{x.label}</span>
                      <span className="font-medium tabular-nums">{formatHours(a.byType[x.key] ?? 0)} h</span>
                      <span className="text-zinc-500 tabular-nums">{pct(a.byType[x.key] ?? 0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="card p-4">
              <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">{t("Hours by job")}</h2>
              <BarList items={jobItems} />
            </section>
          </div>

          <section className="card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Weekly hours & tickets")}</h2>
              <Legend
                items={[
                  ...typesWithHours.map((x) => ({ color: x.color, label: x.label })),
                  a.jira
                    ? { dot: "bg-emerald-400", label: t("✓ tickets closed") }
                    : { dot: "bg-sky-400", label: t("🎫 tickets worked") },
                ]}
              />
            </div>
            <WeeklyBars weeks={weekColumns} />
          </section>

          {a.jira && a.hasTicketDates && (
            <div className="grid gap-4 lg:grid-cols-2">
              <section className="card p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Performance")}</h2>
                  <span className="text-xs text-zinc-500">{t("resolution time · lower is better")}</span>
                </div>
                <LineChart points={performancePoints} colorClass="text-indigo-500" unit=" d" empty={t("No tickets closed in range.")} />
                <p className="mt-2 text-xs text-zinc-400">{t("Avg days from a ticket opening to its resolution, by the week it was resolved.")}</p>
              </section>
              <section className="card p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Parallelism")}</h2>
                  <span className="text-xs text-zinc-500">{t("tickets open at once")}</span>
                </div>
                <LineChart points={parallelPoints} colorClass="text-amber-500" empty={t("No open tickets.")} />
                <p className="mt-2 text-xs text-zinc-400">{t("Number of tickets in flight (opened but not yet resolved) during each week.")}</p>
              </section>
            </div>
          )}

          {a.jira && !a.hasTicketDates && (
            <p className="card p-4 text-sm text-zinc-500">
              {rich(t("Reaction time and parallelism need ticket <em>opened</em> dates. Re-sync on the Jira tab to backfill them."), {
                em: (s) => <em>{s}</em>,
              })}
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card p-4">
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Hours by")}</h2>
                <LinkSelect
                  label={t("Hours by")}
                  value={split}
                  options={[
                    { value: "tag", label: t("Tag"), href: href(weeks, mine, "tag") },
                    { value: "type", label: t("Type"), href: href(weeks, mine, "type") },
                  ]}
                />
              </div>
              {split === "type" ? (
                <BarList items={typeItems} empty={t("No entries.")} />
              ) : (
                <BarList items={tagItems} empty={t("No tagged entries.")} />
              )}
            </section>
            <section className="card p-4">
              <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase">{t("Top tickets by hours")}</h2>
              <BarList items={ticketItems} empty={t("No tickets.")} />
            </section>
          </div>

          <p className="text-xs text-zinc-400">
            {a.jira
              ? t("“Tickets closed” buckets synced Jira tickets by their resolution date; some done tickets have no resolution date and aren't counted per week. Sync tickets on the Jira tab.")
              : t("“Tickets worked” counts distinct ticket keys booked in a week (activity, not closures). Sync Jira on the Jira tab to track actual closures.")}
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
