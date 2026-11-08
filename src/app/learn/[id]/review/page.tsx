import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import { ReviewDeck } from "@/plugins/learn/ui/ReviewDeck";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Review") };
}

/** Review a course's cards due today (spaced repetition: what you knew well comes back later). */
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  if (!isInstalled("learn")) return <PluginNotInstalled id="learn" />;
  const store = await import("@/plugins/learn/store");
  const course = store.getCourse(Number((await params).id));
  if (!course) notFound();
  const cards = store.dueCards(course.id).map((c) => ({ id: c.id, front: c.front, back: c.back }));
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <Link href={`/learn/${course.id}`} className="text-sm text-zinc-500 hover:underline">
        ← {course.title}
      </Link>
      <h1 className="text-lg font-semibold">{t("Review")}</h1>
      <ReviewDeck cards={cards} />
    </div>
  );
}
