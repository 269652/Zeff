import Link from "next/link";
import { t } from "@/lib/i18n/server";
import { CourseCards, courseCards } from "./CourseCards";
import { ExportSpace } from "./ExportSpace";
import { NewCourseForm } from "./NewCourseForm";

/**
 * A learning space's page in the Workspace (a page holding Learn's databases — dbs.ts learnSpaces): Learn on it — its courses,
 * "Learn something new" into this space, the export. Its databases stay below as the page's children. Server only.
 */
export async function LearnSpaceApp({ pageId }: { pageId: number }) {
  const courses = await courseCards(pageId);
  return (
    <section className="mb-6 space-y-4" data-learn-space={pageId} aria-label={t("Learning space")}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">🎓 {t("Learning space")}</span>
        <span className="text-zinc-500">{t("Courses: {n}", { n: courses.length })}</span>
        <span className="flex-1" />
        <Link href="/learn" className="text-indigo-700 hover:underline dark:text-indigo-300">
          {t("All learning spaces")} →
        </Link>
        <ExportSpace pageId={pageId} />
      </div>
      <CourseCards courses={courses} inWorkspace />
      <NewCourseForm space={pageId} />
    </section>
  );
}
