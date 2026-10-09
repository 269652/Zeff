import { round2 } from "./format";
import { isoDate, type WeekInfo } from "./week";

/** A day against its target: "missing" once it is over and short, "short" while it is today, else "ok". */
export type DayShortfall = { gap: number; state: "missing" | "short" | "ok" };

/**
 * Each day's shortfall against its target (a week's days, or a month's). Future days
 * aren't due yet, and a reporter filter shows only part of the bookings, so there is no
 * verdict then.
 */
export function dayShortfalls(
  week: Pick<WeekInfo, "days">,
  dayTotals: number[],
  targets: number[] | undefined,
  opts: { today: string; filtered?: boolean },
): DayShortfall[] {
  return week.days.map((d, i) => {
    const target = targets?.[i] ?? 0;
    const gap = round2(target - (dayTotals[i] ?? 0));
    if (!targets || opts.filtered || target <= 0 || gap < 0.01) return { gap: 0, state: "ok" };
    const iso = isoDate(d);
    if (iso < opts.today) return { gap, state: "missing" };
    return { gap, state: iso === opts.today ? "short" : "ok" };
  });
}
