import Link from "next/link";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { DayListItem } from "./DayListItem";

/**
 * Today's day lists (Workspace → New → Day list): each one's progress ("3/7") and its items still open, ticked here in place. No day
 * list: nothing shown. Server component.
 */
export async function TodayDayLists() {
  if (!isInstalled("workspace")) return null;
  let lists: NonNullable<ReturnType<typeof import("@/plugins/workspace/day-lists").dayListState>>[] = [];
  try {
    const { dayListIds, dayListState } = await import("@/plugins/workspace/day-lists");
    lists = dayListIds()
      .map((id) => dayListState(id))
      .filter((s): s is NonNullable<typeof s> => !!s && s.total > 0);
  } catch {
    return null; // (a list that can't be read doesn't take Today down)
  }
  if (!lists.length) return null;
  const open = lists.reduce((a, s) => a + s.total - s.done, 0);
  return (
    <section id="daylists" aria-labelledby="daylists-h" className="scroll-mt-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 id="daylists-h" className="mb-2 text-sm font-semibold text-zinc-500 uppercase">
        {t("Day lists")}
        {open > 0 && <span className="ml-1.5 rounded-full bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 tabular-nums dark:bg-zinc-800">{open}</span>}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {lists.map((s) => (
          <div key={s.id} className="min-w-0 space-y-1.5">
            <Link href={`/workspace/${s.id}`} className="flex items-baseline gap-2 text-sm font-medium hover:underline">
              <span>{s.icon || "🔁"}</span>
              <span className="min-w-0 flex-1 truncate">{s.title}</span>
              <span className={`text-xs tabular-nums ${s.done >= s.total ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-500"}`}>
                {s.done}/{s.total}
              </span>
            </Link>
            <div className="h-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(s.done / s.total) * 100}%` }} />
            </div>
            {s.done >= s.total ? (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">{t("All done today.")}</p>
            ) : (
              <ul className="space-y-1">
                {s.items
                  .filter((i) => !i.done)
                  .map((i) => (
                    <DayListItem key={i.id} id={i.id} title={i.title} dose={i.dose !== null && s.dose ? `${String(i.dose).replace(".", ",")}${s.dose.unit ? ` ${s.dose.unit}` : ""}` : undefined} />
                  ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
