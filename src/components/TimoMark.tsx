import type { TimoDayState } from "@/lib/timo-status";
import { t } from "@/lib/i18n/server";

/**
 * A day's TimO mark in the weekly Booked row: a blue ✓ when TimO has Zeff's hours, an amber
 * "!" when it has something else — its title says what.
 */
export function TimoMark({ day }: { day: TimoDayState }) {
  const synced = day.state === "synced";
  return (
    <span className="ml-1 inline-flex align-[-2px]" title={day.title} aria-label={synced ? t("In TimO — {title}", { title: day.title }) : day.title}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`inline-block size-3.5 ${synced ? "text-blue-600 dark:text-blue-400" : "text-amber-500 dark:text-amber-400"}`}
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        {synced ? <path d="M8.5 12.5l2.5 2.5 4.5-5" /> : <path d="M12 7.5v5.5M12 16.5h.01" />}
      </svg>
    </span>
  );
}
