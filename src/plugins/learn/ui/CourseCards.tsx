import Link from "next/link";
import { t } from "@/lib/i18n/server";

/** What a course's card shows (read on the server: courseCards). */
export type CourseCard = {
  id: number;
  title: string;
  status: "researching" | "ready" | "failed";
  level: number;
  streak: number;
  due: number;
  progress: { share: number; mastered: number; steps: number } | null;
};

/** The courses of a learning space (or of all) as cards: their state, progress, streak and cards due. Server only. */
export async function courseCards(space?: number | null): Promise<CourseCard[]> {
  const store = await import("../store");
  const { levelOf } = await import("../game");
  const due = new Map(store.dueCount().map((d) => [d.courseId, d.due]));
  return store.listCourses(space).map((c) => {
    const p = c.status === "ready" ? store.courseTree(c.id).tree.progress : null;
    return {
      id: c.id,
      title: c.title,
      status: c.status as CourseCard["status"],
      level: levelOf(c.xp).level,
      streak: c.streak,
      due: due.get(c.id) ?? 0,
      progress: p ? { share: p.share, mastered: p.mastered, steps: p.steps } : null,
    };
  });
}

/** The cards, linking to each course (a server component). */
export function CourseCards({ courses, inWorkspace = false }: { courses: CourseCard[]; /** In the Workspace: a course opens its row there (Learn's screen on it). */ inWorkspace?: boolean }) {
  if (!courses.length) return null;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {courses.map((c) => (
        <li key={c.id}>
          <Link href={inWorkspace ? `/workspace/${c.id}` : `/learn/${c.id}`} className="card block h-full space-y-2 p-4 hover:border-indigo-300 dark:hover:border-indigo-700">
            <div className="flex items-start gap-2">
              <span className="min-w-0 flex-1 font-semibold">{c.title}</span>
              {c.status === "ready" && <span className="shrink-0 rounded-full bg-indigo-100 px-2 text-xs font-medium text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">{t("Level {n}", { n: c.level })}</span>}
            </div>
            {c.status === "researching" && <p className="text-sm text-zinc-500">{t("Claude is researching and planning …")}</p>}
            {c.status === "failed" && <p className="text-sm text-red-700 dark:text-red-400">{t("The research failed.")}</p>}
            {c.progress && (
              <>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(c.progress.share * 100)} aria-label={t("Progress")}>
                  <div className="h-full bg-emerald-500" style={{ width: `${Math.round(c.progress.share * 100)}%` }} />
                </div>
                <p className="flex flex-wrap gap-x-3 text-xs text-zinc-500">
                  <span>{t("{done} of {total} steps", { done: c.progress.mastered, total: c.progress.steps })}</span>
                  {c.streak > 0 && <span title={t("days in a row")}>🔥 {c.streak}</span>}
                  {c.due > 0 && <span>🃏 {t("{n} cards due", { n: c.due })}</span>}
                </p>
              </>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
