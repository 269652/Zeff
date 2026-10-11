import Link from "next/link";
import { currentMonth, formatMonth, shiftMonth, type MonthInfo } from "@/lib/month";
import { MonthJump } from "./MonthJump";
import { t } from "@/lib/i18n/server";

function monthHref(m: MonthInfo, by?: string) {
  return `/month?month=${m.key}${by ? `&by=${encodeURIComponent(by)}` : ""}`;
}

export function MonthNav({ month, by, reporters }: { month: MonthInfo; by?: string; reporters: string[] }) {
  const isCurrent = month.key === currentMonth().key;
  const csvHref = `/api/report?month=${month.key}${by ? `&by=${encodeURIComponent(by)}` : ""}`;
  const first = month.weeks[0];
  const last = month.weeks[month.weeks.length - 1];

  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-center gap-2">
        <Link className="btn" href={monthHref(shiftMonth(month, -1), by)} aria-label={t("Previous month")}>
          ←
        </Link>
        <div className="min-w-44 text-center">
          <h1 className="text-lg font-semibold">{formatMonth(month)}</h1>
          <div className="text-sm text-zinc-500 dark:text-zinc-400">
            {t("Weeks {first}–{last}", { first: first.week, last: last.week })}
          </div>
        </div>
        <Link className="btn" href={monthHref(shiftMonth(month, 1), by)} aria-label={t("Next month")}>
          →
        </Link>
        {!isCurrent && (
          <Link className="btn btn-sm" href={monthHref(currentMonth(), by)}>
            {t("This month")}
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <MonthJump key={`${month.key}|${by ?? ""}`} monthKey={month.key} by={by} reporters={reporters} />
        <a href={csvHref} className="btn" download>
          CSV
        </a>
      </div>
    </div>
  );
}
