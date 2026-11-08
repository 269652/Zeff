import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import { getTodo } from "@/lib/todos/store";
import { runsForTodos } from "@/lib/work/store";
import { isActive, type WorkRunView } from "@/lib/work/shared";
import { ClaudeSession } from "@/components/work/ClaudeSession";
import { SessionThread, type SessionTurn } from "@/components/work/SessionThread";
import { ChatComposer } from "@/app/chat/ChatComposer";
import { ScrollToEnd } from "@/app/chat/ScrollToEnd";
import { LessonButton } from "@/plugins/learn/ui/LessonButton";
import { LessonWidgets } from "@/plugins/learn/ui/LessonWidgets";

type Props = { params: Promise<{ id: string; key: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!isInstalled("learn")) return { title: t("Learn") };
  const { getNode } = await import("@/plugins/learn/store");
  const p = await params;
  return { title: getNode(Number(p.id), decodeURIComponent(p.key))?.title ?? t("Learn") };
}

/**
 * A step's lesson: what it's about and its goals; the exercises the teacher built (widgets, newest large); the chat with
 * the teacher (Claude, as a live session on the step's own todo — src/plugins/learn/teacher.ts). Not begun yet: a button.
 */
export default async function StepPage({ params }: Props) {
  await connection();
  if (!isInstalled("learn")) return <PluginNotInstalled id="learn" />;
  const store = await import("@/plugins/learn/store");
  const p = await params;
  const courseId = Number(p.id);
  const course = store.getCourse(courseId);
  const node = course && store.getNode(courseId, decodeURIComponent(p.key));
  if (!course || !node || node.kind !== "step") notFound();
  const { nodes, tree } = store.courseTree(courseId);
  const status = tree.status.get(node.key) ?? "locked";
  const parent = nodes.find((n) => n.key === node.parent);
  const blockers = node.requires.map((k) => nodes.find((n) => n.key === k)).filter((n) => n && tree.status.get(n.key) !== "mastered");
  const widgets = store.nodeWidgets(courseId, node.key).map((w) => ({ id: w.id, title: w.title, html: w.html, libs: w.libs, bestScore: w.bestScore }));

  const runs = node.lessonTodoId ? (runsForTodos([node.lessonTodoId]).get(node.lessonTodoId) ?? []) : [];
  const conversation: WorkRunView[] = [...runs].reverse();
  const todo = node.lessonTodoId ? getTodo(node.lessonTodoId) : undefined;
  const turns: SessionTurn[] = conversation.map((r) => ({
    run: r,
    ask: todo?.userNotes.filter((n) => n.kind === "instruction" && n.run === r.id).map((n) => n.text).join("\n\n") || null,
    label: "",
  }));
  const last = conversation[conversation.length - 1];
  const live = !!last?.session && last.status === "running";

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <Link href={`/learn/${courseId}`} className="text-sm text-zinc-500 hover:underline">
        ← {course.title}
      </Link>
      <header className="space-y-1">
        {parent && <p className="text-xs text-zinc-500">{parent.title}</p>}
        <h1 className="text-lg font-semibold">
          {node.title}
          {status === "mastered" && <span className="ml-2 text-sm font-normal text-emerald-700 dark:text-emerald-400">✓ {t("mastered")}</span>}
        </h1>
        {node.summary && <p className="max-w-[75ch] text-sm text-zinc-600 dark:text-zinc-400">{node.summary}</p>}
        {node.objectives.length > 0 && (
          <ul className="list-disc pl-5 text-sm text-zinc-600 dark:text-zinc-400" aria-label={t("Goals")}>
            {node.objectives.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ul>
        )}
      </header>

      {status === "locked" ? (
        <div className="card space-y-2 p-4">
          <p className="font-medium">🔒 {t("This step is still locked: master what it requires first.")}</p>
          {blockers.length > 0 && (
            <ul className="text-sm">
              {blockers.map((b) => (
                <li key={b!.key}>
                  <Link href={`/learn/${courseId}/step/${encodeURIComponent(b!.key)}`} className="text-indigo-700 hover:underline dark:text-indigo-300">
                    {b!.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : !last ? (
        <div className="card space-y-3 p-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("Claude teaches this step in a chat — explaining, asking, and building exercises right here. When you've got it, it marks the step mastered.")}</p>
          <LessonButton courseId={courseId} stepKey={node.key} />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="min-w-0">
            {widgets.length > 0 ? <LessonWidgets widgets={widgets} /> : <p className="card p-4 text-sm text-zinc-500">{t("The exercises the teacher builds appear here.")}</p>}
          </div>
          <section className="flex min-w-0 flex-col gap-2 lg:sticky lg:top-2 lg:max-h-[calc(100dvh-6rem)]" aria-label={t("Lesson chat")}>
            <div id="lesson-thread" className="max-h-[60vh] min-h-0 flex-1 overflow-y-auto lg:max-h-none">
              <SessionThread turns={turns} />
            </div>
            <ScrollToEnd target="lesson-thread" />
            <div className="shrink-0 border-t border-zinc-200 pt-2 dark:border-zinc-800">
              {live ? <ClaudeSession key={last.id} run={last} /> : <ChatComposer runId={last.id} stay placeholder={isActive(last.status) ? t("Working … — your message goes in when it has answered") : t("Answer the teacher …")} />}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
