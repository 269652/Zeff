/**
 * Schedule constants and types with NO server-only imports, so client components
 * (forms) can use them without pulling the database driver into the client bundle.
 */
export const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const ABSENCE_TYPES = ["vacation", "sick", "holiday", "other"] as const;
export type AbsenceType = (typeof ABSENCE_TYPES)[number];

export const ABSENCE_LABELS: Record<AbsenceType, string> = {
  vacation: "Vacation",
  sick: "Sick",
  holiday: "Holiday",
  other: "Absence",
};
