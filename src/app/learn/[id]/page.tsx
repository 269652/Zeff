import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import { CourseScreen } from "@/plugins/learn/ui/CourseScreen";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!isInstalled("learn")) return { title: t("Learn") };
  const { getCourse } = await import("@/plugins/learn/store");
  return { title: getCourse(Number((await params).id))?.title ?? t("Learn") };
}

/** A course on Learn's own page (the same screen as on its row in the Workspace — CourseScreen). */
export default async function CoursePage({ params }: Props) {
  await connection();
  if (!isInstalled("learn")) return <PluginNotInstalled id="learn" />;
  const asked = Number((await params).id);
  const course = (await import("@/plugins/learn/store")).getCourse(asked);
  if (!course) notFound();
  // (An old link — the course's id from before Learn's data moved into the Workspace: to where it is now.)
  if (course.id !== asked) redirect(`/learn/${course.id}`);
  return <CourseScreen courseId={course.id} where="app" />;
}
