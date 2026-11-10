import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import { LessonScreen } from "@/plugins/learn/ui/LessonScreen";

type Props = { params: Promise<{ id: string; key: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!isInstalled("learn")) return { title: t("Learn") };
  const { getNode } = await import("@/plugins/learn/store");
  const p = await params;
  return { title: getNode(Number(p.id), decodeURIComponent(p.key))?.title ?? t("Learn") };
}

/** A step's lesson on Learn's own page (the same screen as on its row in the Workspace — LessonScreen). */
export default async function StepPage({ params }: Props) {
  await connection();
  if (!isInstalled("learn")) return <PluginNotInstalled id="learn" />;
  const store = await import("@/plugins/learn/store");
  const p = await params;
  const courseId = Number(p.id);
  const course = store.getCourse(courseId);
  const node = course && store.getNode(course.id, decodeURIComponent(p.key));
  if (!course || !node || node.kind !== "step") notFound();
  // (An old link — the course's id from before Learn's data moved into the Workspace: to where it is now.)
  if (course.id !== courseId) redirect(`/learn/${course.id}/step/${encodeURIComponent(node.key)}`);
  return <LessonScreen courseId={course.id} stepKey={node.key} where="app" />;
}
