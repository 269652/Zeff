import Link from "next/link";
import type { DayShortfall } from "@/lib/day-status";
import { formatHours, round2 } from "@/lib/format";
import type { MonthInfo } from "@/lib/month";
import type { DayTarget } from "@/lib/schedule";
import { absenceLabels, type AbsenceType } from "@/lib/schedule-shared";
import { isoDate } from "@/lib/week";
import { t } from "@/lib/i18n/server";

const weekdays = () => [t("Mon"), t("Tue"), t("Wed"), t("Thu"), t("Fri"), t("Sat"), t("Sun")];

const APPROVED_TEXT = "text-emerald-700 dark:text-emerald-300";
const PENDING_TEXT = "text-orange-600 dark:text-orange-400";

/** A day's hours approved in the booking system (Chrono) — null while its week hasn't been pulled. */
export type DayApproval = { approved: number } | null;

/**
 * Each day's booked hours, a row per week; a day links to its week. Green = every entry
 * approved in the booking system; "8 / 12" = 8 of 12 h approved; orange hours = none approved yet; red =
 * hours missing on a past day; amber = still due today.
 */
export function MonthCalendar({
  month,
  dayTotals,
  approvals,
  targets,
  shortfalls,
  today,
}: {
  month: MonthInfo;
  /** Hours per day of the month (index 0 = the 1st). */
  dayTotals: number[];
  /** A booking system's approval per day of the month (a plugin of an integration: Chrono) — none: no hints. */
  approvals?: { system: string; days: DayApproval[] };
  targets: DayTarget[];
  shortfalls: DayShortfall[];
  today: string;
}) {
  const index = new Map(month.days.map((d, i) => [isoDate(d), i]));
  const chronoOn = !!approvals;
  const chrono = approvals?.days ?? [];
  const system = approvals?.system ?? "";

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[36rem] grid-cols-[3rem_repeat(7,minmax(0,1fr))_4.5rem] gap-1 text-sm">
        <div />
        {weekdays().map((d, i) => (
          <div key={d} className={`px-2 text-xs font-medium uppercase ${i >= 5 ? "text-zinc-400" : "text-zinc-500"}`}>
            {d}
          </div>
        ))}
        <div className="px-2 text-right text-xs font-medium text-zinc-500 uppercase">{t("Week")}</div>

        {month.weeks.map((w) => {
          const inMonth = w.days.map((d) => index.get(isoDate(d)));
          const booked = round2(inMonth.reduce<number>((a, i) => a + (i === undefined ? 0 : dayTotals[i]), 0));
          const target = round2(inMonth.reduce<number>((a, i) => a + (i === undefined ? 0 : targets[i].target), 0));
          return [
            <Link
              key={`${w.key}-label`}
              href={`/?week=${w.key}`}
              className="flex items-center justify-center rounded-md text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              title={t("Open week {week}", { week: w.week })}
            >
              {t("W{week}", { week: w.week })}
            </Link>,
            ...w.days.map((d, k) => {
              const i = inMonth[k];
              if (i === undefined) return <div key={isoDate(d)} className="min-h-14 rounded-md" aria-hidden />;
              return (
                <DayCell
                  key={isoDate(d)}
                  weekKey={w.key}
                  date={d}
                  hours={dayTotals[i]}
                  chrono={chrono[i]}
                  chronoOn={chronoOn}
                  system={system}
                  target={targets[i]}
                  shortfall={shortfalls[i]}
                  isToday={isoDate(d) === today}
                  future={isoDate(d) > today}
                />
              );
            }),
            <div key={`${w.key}-total`} className="flex flex-col items-end justify-center px-2 tabular-nums">
              <span className="font-semibold">{booked ? formatHours(booked) : "–"}</span>
              {target > 0 && <span className="text-[11px] text-zinc-400">{t("of {hours}", { hours: formatHours(target) })}</span>}
            </div>,
          ];
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
        <LegendDot className="bg-emerald-100 dark:bg-emerald-900/60" label={t("all approved in {system}", { system })} />
        <span>
          <span className={`font-semibold ${APPROVED_TEXT}`}>8</span> / <span className={`font-semibold ${PENDING_TEXT}`}>12</span>{" "}
          {t("approved / booked")}
        </span>
        <span>
          <span className={`font-semibold ${PENDING_TEXT}`}>8</span> {t("not approved yet")}
        </span>
        <LegendDot className="bg-red-100 dark:bg-red-900/60" label={t("hours missing")} />
        <LegendDot className="bg-amber-100 dark:bg-amber-900/60" label={t("due today")} />
        <LegendDot className="bg-zinc-100 dark:bg-zinc-800" label={t("off / absent")} />
        {chronoOn && chrono.some((r, i) => r === null && dayTotals[i] > 0) && (
          <span className="text-zinc-400">{t("plain hours: week not pulled from {system}", { system })}</span>
        )}
      </div>
    </div>
  );
}

function DayCell({
  weekKey,
  date,
  hours,
  chrono,
  target,
  shortfall,
  isToday,
  future,
  chronoOn,
  system,
}: {
  chronoOn: boolean;
  system: string;
  weekKey: string;
  date: Date;
  hours: number;
  chrono: DayApproval;
  target: DayTarget;
  shortfall: DayShortfall;
  isToday: boolean;
  future: boolean;
}) {
  const off = target.target <= 0;
  const approved = chrono ? round2(chrono.approved) : 0;
  const allApproved = !!chrono && hours > 0 && approved >= round2(hours);
  const partlyApproved = !!chrono && approved > 0 && !allApproved;
  const noneApproved = !!chrono && hours > 0 && approved === 0;
  const tone =
    shortfall.state === "missing"
      ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
      : shortfall.state === "short"
        ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
        : allApproved
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          : off
            ? "bg-zinc-50 text-zinc-500 dark:bg-zinc-900/60 dark:text-zinc-400"
            : "bg-white dark:bg-zinc-950";
  const note = target.absence
    ? absenceLabels(t)[target.absence.type as AbsenceType]
    : off && target.base <= 0
      ? t("off")
      : "";
  const title = [
    t("{hours} h booked", { hours: hours ? formatHours(hours) : 0 }),
    target.target > 0 ? t("target {hours} h", { hours: formatHours(target.target) }) : "",
    shortfall.state !== "ok"
      ? shortfall.state === "missing"
        ? t("{hours} h missing", { hours: formatHours(shortfall.gap) })
        : t("{hours} h still due", { hours: formatHours(shortfall.gap) })
      : "",
    hours > 0 && chronoOn
      ? !chrono
        ? t("week not pulled from {system}", { system })
        : allApproved
          ? t("all approved in {system}", { system })
          : partlyApproved
            ? t("{approved} of {hours} h approved in {system}", { approved: formatHours(approved), hours: formatHours(hours), system })
            : t("not approved in {system} yet", { system })
      : "",
    note,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      href={`/?week=${weekKey}`}
      title={title}
      className={`flex min-h-14 flex-col justify-between rounded-md border border-zinc-200 px-2 py-1 transition hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-500 ${tone} ${
        isToday ? "ring-2 ring-indigo-400 dark:ring-indigo-500" : ""
      }`}
    >
      <div className="flex items-baseline justify-between gap-1 text-[11px]">
        <span className={isToday ? "font-semibold text-indigo-600 dark:text-indigo-400" : "opacity-70"}>{date.getDate()}</span>
        {note && <span className="truncate opacity-80">{note}</span>}
      </div>
      <div className="text-right font-semibold tabular-nums">
        {hours > 0 ? (
          partlyApproved ? (
            <>
              <span className={APPROVED_TEXT}>{formatHours(approved)}</span>
              <span className="font-normal text-zinc-400"> / </span>
              <span className={PENDING_TEXT}>{formatHours(hours)}</span>
            </>
          ) : (
            <span className={allApproved ? APPROVED_TEXT : noneApproved ? PENDING_TEXT : undefined}>{formatHours(hours)}</span>
          )
        ) : future || off ? (
          ""
        ) : (
          "0"
        )}
        {shortfall.state !== "ok" && <span className="ml-1 text-[11px] font-normal">−{formatHours(shortfall.gap)}</span>}
      </div>
    </Link>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block size-2.5 rounded-sm ${className}`} />
      {label}
    </span>
  );
}
