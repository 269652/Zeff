/**
 * Schedule constants and types with NO server-only imports, so client components
 * (forms) can use them without pulling the database driver into the client bundle.
 */
import { translator, type T } from "@/lib/i18n/shared";

export const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

/** The weekdays' short names in a language (client: `weekdayLabels(useT())`). */
export const weekdayLabels = (t: T) => [t("Mon"), t("Tue"), t("Wed"), t("Thu"), t("Fri"), t("Sat"), t("Sun")];
/** In English (shown through t() — or use weekdayLabels(t)). */
export const WEEKDAY_LABELS = weekdayLabels(translator("en"));

export const ABSENCE_TYPES = ["vacation", "sick", "holiday", "other"] as const;
export type AbsenceType = (typeof ABSENCE_TYPES)[number];

/** What flex-time bookings say unless set otherwise on the Schedule page. */
export const DEFAULT_FLEX_COMMENT = "Überstundenabbau";

/** The flex-time (Gleitzeit) setting: the job a day's missing hours go to (null = off), and what they say. */
export type FlexTime = { jobNumber: string | null; comment: string };

/** The absence types' names in a language (client: `absenceLabels(useT())`). */
export const absenceLabels = (t: T): Record<AbsenceType, string> => ({
  vacation: t("Vacation"),
  sick: t("Sick"),
  holiday: t("Holiday"),
  other: t("Absence"),
});
/** In English (shown through t() — or use absenceLabels(t)). */
export const ABSENCE_LABELS: Record<AbsenceType, string> = absenceLabels(translator("en"));
