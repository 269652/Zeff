import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import { CourseCards, courseCards } from "@/plugins/learn/ui/CourseCards";
import { NewCourseForm } from "@/plugins/learn/ui/NewCourseForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Learn") };
}

/**
 * Learn (Learn plugin): your courses — each a topic Claude researched and planned over years, phases, skills and small
 * steps, a skill tree you work through with Claude as the teacher. By learning space (a page in the Workspace holding Learn's
 * databases — each its own courses and progress; more from the template "Learning space"). A new one: the form.
 */
export default async function LearnPage() {
  await connection();
  if (!isInstalled("learn")) return <PluginNotInstalled id="learn" />;
  const ws = isInstalled("workspace");
  const { learnDbs, learnSpaces } = await import("@/plugins/learn/dbs");
  const { getPage } = await import("@/plugins/workspace/store");
  learnDbs(); // (the first space there)
  const spaces = await Promise.all(
    learnSpaces().map(async (s) => {
      const p = getPage(s.folder);
      return { id: s.folder, title: p?.title || t("Untitled"), icon: p?.icon || "🎓", courses: await courseCards(s.folder) };
    }),
  );
  const several = spaces.length > 1;
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold">{t("Learn")}</h1>
        <p className="max-w-[75ch] text-sm text-zinc-500">{t("Pick a topic: Claude researches it and plans it as a skill tree — years, phases, skills and small steps. Claude teaches each step in a chat, with exercises it builds for you.")}</p>
        {ws && <p className="text-sm text-zinc-500">{t("Each learning space is a page in the Workspace with its own courses and progress — make another from the template “Learning space”.")}</p>}
      </header>
      {spaces.map((s) => (
        <section key={s.id} className="space-y-3" aria-label={s.title}>
          {(several || ws) && (
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <span aria-hidden>{s.icon}</span>
              {ws ? (
                <Link href={`/workspace/${s.id}`} className="hover:underline">
                  {s.title}
                </Link>
              ) : (
                s.title
              )}
              <span className="text-sm font-normal text-zinc-500">· {t("Courses: {n}", { n: s.courses.length })}</span>
            </h2>
          )}
          <CourseCards courses={s.courses} />
        </section>
      ))}
      <NewCourseForm spaces={spaces.map((s) => ({ id: s.id, title: s.title }))} />
    </div>
  );
}
