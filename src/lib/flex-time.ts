import { parseISO } from "date-fns";
import { createEntry, getDayTotals } from "./entries";
import { ValidationError } from "./errors";
import { round2 } from "./format";
import { t } from "@/lib/i18n/server";
import { getJobByNumber } from "./jobs";
import { getDayTargets, getFlexTime } from "./schedule";
import { formatDay, isValidIsoDate, todayIso } from "./week";

export type FlexTimeBooking = {
  jobNumber: string;
  comment: string;
  booked: { date: string; label: string; hours: number }[];
  skipped: { date: string; label: string; reason: string }[];
};

/**
 * Book flex time (Gleitzeit) for days that aren't fully booked: each day's missing hours — its
 * target minus what's booked right now — on the flex-time job, described with its comment.
 * Days still ahead, days off and full days are left alone, so a second click books nothing twice.
 */
export function bookFlexTime(dates: string[], today = todayIso()): FlexTimeBooking {
  const flex = getFlexTime();
  if (!flex.jobNumber) throw new ValidationError(t("Pick the flex-time job on the Schedule page first."));
  const job = getJobByNumber(flex.jobNumber);
  if (!job) throw new ValidationError(t("The flex-time job {job} doesn't exist any more — pick another on the Schedule page.", { job: flex.jobNumber }));

  const res: FlexTimeBooking = { jobNumber: job.number, comment: flex.comment, booked: [], skipped: [] };
  const days = [...new Set(dates)].filter(isValidIsoDate).sort();
  if (!days.length) return res;
  const booked = getDayTotals(days[0], days[days.length - 1]);
  const targets = new Map(getDayTargets(days.map((d) => parseISO(d))).map((x) => [x.date, x.target]));
  for (const date of days) {
    const label = formatDay(parseISO(date), "EEE d.M.");
    const target = targets.get(date) ?? 0;
    const gap = round2(target - (booked.get(date) ?? 0));
    if (date > today) res.skipped.push({ date, label, reason: t("is still ahead") });
    else if (target <= 0) res.skipped.push({ date, label, reason: t("isn't a working day") });
    else if (gap < 0.01) res.skipped.push({ date, label, reason: t("is already fully booked") });
    else {
      createEntry({ jobNumber: job.number, date, hours: gap, description: flex.comment }, "web");
      res.booked.push({ date, label, hours: gap });
    }
  }
  return res;
}
