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
import { ChatComposer } from "@/app/chat/ChatComposer";
import { ScrollToEnd } from "@/app/chat/ScrollToEnd";
import { StuckRun } from "@/app/chat/StuckRun";
import { DanglingSessions } from "@/components/work/DanglingSessions";
import { LessonButton } from "@/plugins/learn/ui/LessonButton";
import { LessonTimeline, type TimelineRun } from "@/plugins/learn/ui/LessonTimeline";

type Props = { params: Promise<{ id: string; key: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!isInstalled("learn")) return { title: t("Learn") };
  const { getNode } = await import("@/plugins/learn/store");
  const p = await params;
  return { title: getNode(Number(p.id), decodeURIComponent(p.key))?.title ?? t("Learn") };
}

/**
 * A step's lesson: what it's about and its goals; then what happened, as a timeline — your messages, the exercises the
 * teacher built and your answers left, the teacher's explanations right (the chat with Claude, a live session on the
 * step's own todo — src/plugins/learn/teacher.ts); the message box below. Not begun yet: a button.
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
  const widgets = store.nodeWidgets(courseId, node.key).map((w) => ({ id: w.id, title: w.title, html: w.html, libs: w.libs, bestScore: w.bestScore, createdAt: w.createdAt }));
  const results = store.widgetResults(courseId, node.key);

  const runs = node.lessonTodoId ? (runsForTodos([node.lessonTodoId]).get(node.lessonTodoId) ?? []) : [];
  const conversation: WorkRunView[] = [...runs].reverse();
  const todo = node.lessonTodoId ? getTodo(node.lessonTodoId) : undefined;
  const timelineRuns: TimelineRun[] = conversation.map((r) => ({
    id: r.id,
    startedAt: r.startedAt ?? r.queuedAt,
    prompts: todo?.userNotes.filter((n) => n.kind === "instruction" && n.run === r.id).map((n) => n.text) ?? [],
    active: isActive(r.status),
    live: !!r.session,
  }));
  const last = conversation[conversation.length - 1];
  // A live session still running takes the next message (never a second run queued behind it, waiting for its worker).
  const liveRun = [...conversation].reverse().find((r) => !!r.session && r.status === "running");
  // Running, but no live session answers (Zeff lost it): what comes after would wait for it forever.
  const lost = liveRun ? undefined : conversation.find((r) => r.status === "running" && !r.session && !r.live);
  // (On the phone's server the sessions are followed by Zeff's own: one it follows isn't lost.)
  const stuck = lost && !(await (await import("@/lib/work/live-state")).liveState(lost.id)).followed ? lost : undefined;

  const chat = (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2" aria-label={t("Lesson chat")}>
      {!last ? (
        <div className="card space-y-3 p-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("Claude teaches this step in a chat — explaining, asking, and building exercises right here. When you've got it, it marks the step mastered.")}</p>
          <LessonButton courseId={courseId} stepKey={node.key} />
        </div>
      ) : (
        <>
          <div id="lesson-thread" data-timeline-scroll className="min-h-0 flex-1 overflow-y-auto pr-1">
            <LessonTimeline runs={timelineRuns} widgets={widgets} results={results} sessionRunId={liveRun?.id ?? last.id} />
          </div>
          <ScrollToEnd target="lesson-thread" />
          <div className="max-h-[45%] shrink-0 overflow-y-auto border-t border-zinc-200 pt-2 dark:border-zinc-800">
            {stuck && <StuckRun runId={stuck.id} />}
            {/* Your message waits for a worker: said here — and what holds the workers, with the button that frees them. */}
            {!liveRun && last.status === "queued" && <DanglingSessions waiting className="mb-2" />}
            {liveRun ? <ClaudeSession key={liveRun.id} run={liveRun} /> : <ChatComposer runId={last.id} stay placeholder={isActive(last.status) ? t("Working … — your message goes in when it has answered") : t("Answer the teacher …")} />}
          </div>
        </>
      )}
    </section>
  );

  return (
    // Like the chat, the lesson fills the window (MainArea's full-height pages): its timeline scrolls — you and the
    // exercises left of the line, the teacher right of it (LessonTimeline) — the message box stays at the bottom.
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-3">
      <header className="shrink-0 space-y-0.5">
        <Link href={`/learn/${courseId}`} className="text-sm text-zinc-500 hover:underline">
          ← {course.title}
        </Link>
        <h1 className="text-lg font-semibold">
          {parent && <span className="font-normal text-zinc-500">{parent.title} · </span>}
          {node.title}
          {status === "mastered" && <span className="ml-2 text-sm font-normal text-emerald-700 dark:text-emerald-400">✓ {t("mastered")}</span>}
        </h1>
        {(node.summary || node.objectives.length > 0) && (
          <details className="text-sm text-zinc-600 dark:text-zinc-400">
            <summary className="cursor-pointer">{t("Goals")}</summary>
            {node.summary && <p className="mt-1 max-w-[75ch]">{node.summary}</p>}
            {node.objectives.length > 0 && (
              <ul className="mt-1 list-disc pl-5">
                {node.objectives.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            )}
          </details>
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
      ) : (
        chat
      )}
    </div>
  );
}
