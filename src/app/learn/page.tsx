import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import { NewCourseForm } from "@/plugins/learn/ui/NewCourseForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Learn") };
}

/**
 * Learn (Learn plugin): your courses — each a topic Claude researched and planned over years, phases, skills and small
 * steps, a skill tree you work through with Claude as the teacher. A new one: the form.
 */
export default async function LearnPage() {
  await connection();
  if (!isInstalled("learn")) return <PluginNotInstalled id="learn" />;
  const store = await import("@/plugins/learn/store");
  const { levelOf } = await import("@/plugins/learn/game");
  const due = new Map(store.dueCount().map((d) => [d.courseId, d.due]));
  const courses = store.listCourses().map((c) => ({ c, progress: c.status === "ready" ? store.courseTree(c.id).tree.progress : null }));
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold">{t("Learn")}</h1>
        <p className="max-w-[75ch] text-sm text-zinc-500">{t("Pick a topic: Claude researches it and plans it as a skill tree — years, phases, skills and small steps. Claude teaches each step in a chat, with exercises it builds for you.")}</p>
      </header>
      {courses.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {courses.map(({ c, progress }) => {
            const lv = levelOf(c.xp);
            return (
              <li key={c.id}>
                <Link href={`/learn/${c.id}`} className="card block h-full space-y-2 p-4 hover:border-indigo-300 dark:hover:border-indigo-700">
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 font-semibold">{c.title}</span>
                    {c.status === "ready" && <span className="shrink-0 rounded-full bg-indigo-100 px-2 text-xs font-medium text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">{t("Level {n}", { n: lv.level })}</span>}
                  </div>
                  {c.status === "researching" && <p className="text-sm text-zinc-500">{t("Claude is researching and planning …")}</p>}
                  {c.status === "failed" && <p className="text-sm text-red-700 dark:text-red-400">{t("The research failed.")}</p>}
                  {progress && (
                    <>
                      <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.share * 100)} aria-label={t("Progress")}>
                        <div className="h-full bg-emerald-500" style={{ width: `${Math.round(progress.share * 100)}%` }} />
                      </div>
                      <p className="flex flex-wrap gap-x-3 text-xs text-zinc-500">
                        <span>{t("{done} of {total} steps", { done: progress.mastered, total: progress.steps })}</span>
                        {c.streak > 0 && <span>🔥 {t("{n} days", { n: c.streak })}</span>}
                        {(due.get(c.id) ?? 0) > 0 && <span>🃏 {t("{n} cards due", { n: due.get(c.id) ?? 0 })}</span>}
                      </p>
                    </>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <NewCourseForm />
    </div>
  );
}
