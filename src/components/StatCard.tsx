import Link from "next/link";
import type { DayShortfall } from "@/lib/day-status";
import { formatDate, formatHours, round2 } from "@/lib/format";
import type { PastWeeksDue } from "@/lib/monthly";
import { StatusIcon } from "./StatusIcon";

/** A card's status: its color, icon and a one-line caption under the value. */
export type StatView = { color: keyof typeof STAT_COLORS; icon: "cross" | "info" | "check"; caption: React.ReactNode };

const STAT_COLORS = {
  red: { border: "border-red-200 dark:border-red-900", bg: "bg-red-50 dark:bg-red-950/40", text: "text-red-700 dark:text-red-300" },
  orange: {
    border: "border-orange-200 dark:border-orange-900",
    bg: "bg-orange-50 dark:bg-orange-950/40",
    text: "text-orange-700 dark:text-orange-300",
  },
  amber: {
    border: "border-amber-200 dark:border-amber-900",
    bg: "bg-amber-50 dark:bg-amber-950/40",
    text: "text-amber-700 dark:text-amber-300",
  },
  green: {
    border: "border-emerald-200 dark:border-emerald-900",
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    text: "text-emerald-700 dark:text-emerald-300",
  },
};

/** A value's color without a status view: overtime amber, exactly done green. */
const TONE_TEXT = {
  default: "",
  over: "text-amber-600 dark:text-amber-400",
  done: "text-emerald-600 dark:text-emerald-400",
};

/** A summary card: label, big value, and optionally a colored status with icon and caption. */
export function Stat({
  label,
  value,
  tone = "default",
  view,
  hint,
  children,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "default" | "over" | "done";
  view?: StatView;
  /** A grey caption when there is no status view. */
  hint?: React.ReactNode;
  /** Extra content between the value and the caption. */
  children?: React.ReactNode;
}) {
  const colors = view ? STAT_COLORS[view.color] : undefined;
  const valueClass = colors?.text ?? TONE_TEXT[tone];
  return (
    <div className={`card px-4 py-3 ${colors ? `${colors.border} ${colors.bg}` : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium text-zinc-500 uppercase">{label}</div>
        {view && <StatusIcon kind={view.icon} className={colors?.text} />}
      </div>
      <div className={`text-2xl font-semibold tabular-nums ${valueClass}`}>{value}</div>
      {children}
      {view ? (
        <div className={`text-xs ${colors?.text}`}>{view.caption}</div>
      ) : (
        hint && <div className="text-xs text-zinc-500">{hint}</div>
      )}
    </div>
  );
}

/** A booked period's day, against its target (dayShortfalls), with its name for the caption ("Mon", "6.10."). */
export type BookedDay = { shortfall: DayShortfall; label: string };

/**
 * The booked card's status, like the other cards': red with what's missing on days that are
 * over, amber while today is short or when over the target, green when everything due is
 * booked. Without `days`, green only when it matches the target exactly.
 */
function bookedView(booked: number, target: number, days: BookedDay[] | undefined, started: boolean): StatView | undefined {
  const onTarget = target > 0 && round2(booked) === round2(target);
  if (!days) return onTarget ? { color: "green", icon: "check", caption: "Matches the target" } : undefined;
  const missing = days.filter((d) => d.shortfall.state === "missing");
  if (missing.length) {
    const hours = round2(missing.reduce((a, d) => a + d.shortfall.gap, 0));
    const names = missing.length > 4 ? `${missing.slice(0, 3).map((d) => d.label).join(", ")} +${missing.length - 3}` : missing.map((d) => d.label).join(", ");
    return { color: "red", icon: "cross", caption: `${formatHours(hours)} h missing · ${names}` };
  }
  const over = round2(booked - target);
  if (target > 0 && over > 0) return { color: "amber", icon: "info", caption: `${formatHours(over)} h over the target` };
  const today = days.find((d) => d.shortfall.state === "short");
  if (today) return { color: "amber", icon: "info", caption: `${formatHours(today.shortfall.gap)} h to go today` };
  if (!started || target <= 0) return undefined;
  return { color: "green", icon: "check", caption: onTarget ? "Matches the target" : "All booked so far" };
}

/**
 * Booked against the target, "38 / 40 h", colored like the other cards (see bookedView) — no
 * verdict while a reporter filter shows only part of the bookings; else the period's workdays.
 * With `today` (the period holds it), a line for today's hours under the value.
 */
export function BookedStat({
  label,
  booked,
  target,
  workdays,
  absentDays,
  filtered = false,
  today,
  days,
  started = true,
}: {
  label: string;
  booked: number;
  target: number;
  workdays: number;
  absentDays: number;
  filtered?: boolean;
  /** Today's booked hours and target. */
  today?: { booked: number; target: number };
  /** The period's days against their targets — for the status. */
  days?: BookedDay[];
  /** Whether the period has begun; one still ahead gets no verdict. */
  started?: boolean;
}) {
  const view = filtered ? undefined : bookedView(booked, target, days, started);
  const todayDone = !!today && !filtered && today.target > 0 && round2(today.booked) >= round2(today.target);
  return (
    <Stat
      label={label}
      value={
        <>
          {formatHours(booked)}
          <span className={`font-normal ${view ? "opacity-70" : "text-zinc-400"}`}> / {formatHours(target)} h</span>
        </>
      }
      view={view}
      hint={`${workdays} workday${workdays === 1 ? "" : "s"}${absentDays ? ` · ${absentDays} day${absentDays === 1 ? "" : "s"} absent` : ""}`}
    >
      {today && (
        <div className="text-sm tabular-nums">
          <span className="text-zinc-500">Today </span>
          <span className={`font-semibold ${todayDone ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{formatHours(today.booked)}</span>
          <span className="text-zinc-400">{today.target > 0 ? ` / ${formatHours(today.target)} h` : " h · day off"}</span>
        </div>
      )}
    </Stat>
  );
}

/**
 * Hours still due in completed weeks: red with the missing hours, green when every past
 * day is booked — and a chip per week (red with its missing hours, else green) linking to it.
 */
export function PastWeeksStat({ due }: { due: PastWeeksDue }) {
  const since = formatDate(due.fromIso, { weekday: false });
  const day = (iso: string) => formatDate(iso);
  const shortDays = due.weeks.reduce((a, w) => a + w.shortDays.length, 0);
  const view: StatView | undefined =
    due.filtered || due.weeks.length === 0
      ? undefined
      : due.missing > 0
        ? { color: "red", icon: "cross", caption: `${shortDays} day${shortDays === 1 ? "" : "s"} short since ${since}` }
        : { color: "green", icon: "check", caption: `All booked since ${since}` };
  return (
    <Stat
      label="Due in past weeks"
      value={due.filtered || due.weeks.length === 0 ? "–" : `${formatHours(due.missing)} h`}
      view={view}
      hint={due.filtered ? "Not shown while filtered" : "No past weeks yet"}
    >
      {!due.filtered && due.weeks.length > 0 && (
        <div className="my-1 flex flex-wrap gap-1">
          {due.weeks.map((w) => (
            <Link
              key={w.key}
              href={`/?week=${w.key}`}
              title={
                w.missing > 0
                  ? `Week ${w.week}: ${formatHours(w.missing)} h missing — ${w.shortDays.map((d) => `${day(d.date)} −${formatHours(d.gap)}`).join(", ")}`
                  : `Week ${w.week}: ${formatHours(w.booked)} of ${formatHours(w.target)} h booked`
              }
              className={`rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums hover:brightness-95 dark:hover:brightness-125 ${
                w.missing > 0
                  ? "bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-200"
                  : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200"
              }`}
            >
              W{w.week}
              {w.missing > 0 && ` −${formatHours(w.missing)}`}
            </Link>
          ))}
        </div>
      )}
    </Stat>
  );
}

/** One half of a SplitStat. */
export type StatHalf = {
  label: string;
  value: React.ReactNode;
  /** The value's color when there is no status view (as on Stat). */
  tone?: "default" | "over" | "done";
  view?: StatView;
  /** A grey caption when there is no status view. */
  hint?: React.ReactNode;
  /** Where the value leads (the caption may hold its own links). */
  href?: string;
  /** Tooltip, e.g. the items behind the number. */
  title?: string;
};

/** Two related numbers side by side in one card, each with its own status color, and a shared footer. */
export function SplitStat({ left, right, footer, className = "" }: { left: StatHalf; right: StatHalf; footer?: React.ReactNode; className?: string }) {
  return (
    <div className={`card grid grid-cols-2 overflow-hidden ${className}`}>
      <Half half={left} />
      <Half half={right} divider />
      {footer && (
        <div className="col-span-2 border-t border-zinc-200 px-4 py-1 text-[11px] text-zinc-400 dark:border-zinc-800">{footer}</div>
      )}
    </div>
  );
}

function Half({ half, divider }: { half: StatHalf; divider?: boolean }) {
  const colors = half.view ? STAT_COLORS[half.view.color] : undefined;
  const value = (
    <div className={`text-2xl font-semibold tabular-nums ${colors?.text ?? TONE_TEXT[half.tone ?? "default"]}`}>{half.value}</div>
  );
  return (
    <div className={`px-4 py-3 ${colors?.bg ?? ""} ${divider ? "border-l border-zinc-200 dark:border-zinc-800" : ""}`} title={half.title}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium text-zinc-500 uppercase">{half.label}</div>
        {half.view && <StatusIcon kind={half.view.icon} className={colors?.text} />}
      </div>
      {half.href ? (
        <Link href={half.href} className="inline-block hover:underline">
          {value}
        </Link>
      ) : (
        value
      )}
      {half.view ? (
        <div className={`text-xs ${colors?.text}`}>{half.view.caption}</div>
      ) : (
        half.hint && <div className="text-xs text-zinc-500">{half.hint}</div>
      )}
    </div>
  );
}
