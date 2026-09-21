import Link from "next/link";
import { currentWeek, formatWeekRange, shiftWeek, type WeekInfo } from "@/lib/week";

function weekHref(w: WeekInfo, by?: string) {
  return `/?week=${w.key}${by ? `&by=${encodeURIComponent(by)}` : ""}`;
}

export function WeekNav({
  week,
  by,
  reporters,
}: {
  week: WeekInfo;
  by?: string;
  reporters: string[];
}) {
  const isCurrent = week.key === currentWeek().key;
  const csvHref = `/api/report?week=${week.key}${by ? `&by=${encodeURIComponent(by)}` : ""}`;

  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-center gap-2">
        <Link className="btn" href={weekHref(shiftWeek(week, -1), by)} aria-label="Previous week">
          ←
        </Link>
        <div className="min-w-44 text-center">
          <h1 className="text-lg font-semibold">
            Week {week.week} <span className="text-zinc-400">·</span> {week.year}
          </h1>
          <div className="text-sm text-zinc-500 dark:text-zinc-400">{formatWeekRange(week)}</div>
        </div>
        <Link className="btn" href={weekHref(shiftWeek(week, 1), by)} aria-label="Next week">
          →
        </Link>
        {!isCurrent && (
          <Link className="btn btn-sm" href={weekHref(currentWeek(), by)}>
            This week
          </Link>
        )}
      </div>

      <form method="get" action="/" className="flex flex-wrap items-end gap-2">
        <div>
          <label className="label" htmlFor="week">Jump to week</label>
          <input id="week" type="week" name="week" defaultValue={week.key} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="by">Reported by</label>
          <select id="by" name="by" defaultValue={by ?? ""} className="input min-w-36">
            <option value="">Everyone</option>
            {reporters.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn">Apply</button>
        <a href={csvHref} className="btn" download>
          CSV
        </a>
      </form>
    </div>
  );
}
