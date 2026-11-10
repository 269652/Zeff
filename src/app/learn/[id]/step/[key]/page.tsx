import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
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
import { FailedRun } from "@/app/chat/FailedRun";
import { DanglingSessions } from "@/components/work/DanglingSessions";
import { LessonButton } from "@/plugins/learn/ui/LessonButton";
import { ExtraWorkerButton } from "@/plugins/learn/ui/ExtraWorkerButton";
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
  const node = course && store.getNode(course.id, decodeURIComponent(p.key));
  if (!course || !node || node.kind !== "step") notFound();
  // (An old link — the course's id from before Learn's data moved into the Workspace: to where it is now.)
  if (course.id !== courseId) redirect(`/learn/${course.id}/step/${encodeURIComponent(node.key)}`);
  const { nodes, tree } = store.courseTree(courseId);
  const status = tree.status.get(node.key) ?? "locked";
  const parent = nodes.find((n) => n.key === node.parent);
  const blockers = node.requires.map((k) => nodes.find((n) => n.key === k)).filter((n) => n && tree.status.get(n.key) !== "mastered");
  const widgets = store.nodeWidgets(courseId, node.key).map((w) => ({ id: w.id, title: w.title, html: w.html, libs: w.libs, bestScore: w.bestScore, createdAt: w.createdAt }));
  const results = store.widgetResults(courseId, node.key);

  const runs = node.lessonTodoId ? (runsForTodos([node.lessonTodoId]).get(node.lessonTodoId) ?? []) : [];
  const conversation: WorkRunView[] = [...runs].reverse();
  const todo = node.lessonTodoId ? getTodo(node.lessonTodoId) : undefined;
  // The conversation as the Conversations database has it (brought up to date from the runs' logs first) — what you changed
  // or deleted there is what shows; only what is being said right now comes from the log.
  const conv = await import("@/plugins/learn/conversation");
  if (node.lessonTodoId) conv.syncLesson(node.lessonTodoId);
  const stored = conv.stepMessages(node.id);
  const states = conv.syncStates(conversation.map((r) => r.id));
  const known = new Set(conversation.map((r) => r.id));
  const loose = stored.filter((m) => m.run === null || !known.has(m.run));
  const timelineRuns: TimelineRun[] = [
    // Messages of no run (added in the database, or of a run that's gone): first.
    ...(loose.length ? [{ id: 0, startedAt: loose[0].at, prompts: [], active: false, live: false, messages: loose, synced: 0, done: true }] : []),
    ...conversation.map((r) => ({
      id: r.id,
      startedAt: r.startedAt ?? r.queuedAt,
      prompts: states.has(r.id) ? [] : (todo?.userNotes.filter((n) => n.kind === "instruction" && n.run === r.id).map((n) => n.text) ?? []),
      active: isActive(r.status),
      live: !!r.session,
      messages: stored.filter((m) => m.run === r.id),
      synced: states.get(r.id)?.lines ?? 0,
      done: states.get(r.id)?.done ?? false,
    })),
  ];
  const last = conversation[conversation.length - 1];
  // A live session still running takes the next message (never a second run queued behind it, waiting for its worker).
  let liveRun = [...conversation].reverse().find((r) => !!r.session && r.status === "running");
  // The conversation was changed in the database since the teacher's session last spoke: that session (waiting for you) is
  // closed — the next message starts a fresh one that is told the conversation as it is stored now.
  if (liveRun && node.lessonTodoId && conv.lessonChanged(node.lessonTodoId)) {
    const { liveState } = await import("@/lib/work/live-state");
    if (!(await liveState(liveRun.id)).busy) {
      const runId = liveRun.id;
      const { delegates } = await import("@/lib/host/role");
      await (delegates() ? (await import("@/lib/host/client")).callHost("work.liveDo", { runId, body: { do: "close" } }, 15000) : (await import("@/lib/work/live-actions")).liveDo(runId, { do: "close" })).catch(() => undefined);
      liveRun = undefined;
    }
  }
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
            <LessonTimeline runs={timelineRuns.filter((r) => r.id > 0 || r.messages.length)} widgets={widgets} results={results} sessionRunId={liveRun?.id ?? last.id} />
          </div>
          <ScrollToEnd target="lesson-thread" />
          <div className="max-h-[45%] shrink-0 overflow-y-auto border-t border-zinc-200 pt-2 dark:border-zinc-800">
            {stuck && <StuckRun runId={stuck.id} />}
            {/* The last run failed (Docker down, the CLI not signed in …): said, with why and "Try again" — else nothing came, unexplained. */}
            {!liveRun && (last.status === "failed" || last.status === "interrupted") && (
              <FailedRun runId={last.id} error={last.error} text={timelineRuns[timelineRuns.length - 1]?.prompts.at(-1) ?? ""} />
            )}
            {/* Your message waits for a worker: said here — and what holds the workers, with the button that frees them, and one
                that starts a worker more, reserved for Learn (Settings → Code). */}
            {!liveRun && last.status === "queued" && <DanglingSessions waiting className="mb-2" action={<ExtraWorkerButton />} />}
            {liveRun ? <ClaudeSession key={liveRun.id} run={liveRun} /> : <ChatComposer runId={last.id} stay placeholder={isActive(last.status) ? t("Working … — your message goes in when it has answered") : t("Answer the teacher …")} />}
          </div>
        </>
      )}
    </section>
  );

  return (
    // Like the chat, the lesson fills the window (MainArea's full-height pages): its timeline scrolls — you and the
    // exercises left of the line, the teacher right of it (LessonTimeline) — the message box stays at the bottom.
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-2">
      {/* One line, so the lesson keeps the height (a phone, a small laptop): back, the step's title (cut when long; the
          topic small above it, the course only on a wide screen), its state, and its goals behind a button. */}
      <header className="flex min-w-0 shrink-0 items-center gap-2">
        {/* Breadcrumbs small above the lesson's title — the course, the topic (its skill map) — each a way back. */}
        <div className="min-w-0 flex-1">
          <nav aria-label={t("Breadcrumbs")} className="flex min-w-0 items-center gap-1 text-xs leading-tight text-zinc-500">
            <Link href={`/learn/${courseId}`} className="min-w-0 truncate hover:text-zinc-800 hover:underline dark:hover:text-zinc-200" title={course.title}>
              {course.title}
            </Link>
            {parent && (
              <>
                <span aria-hidden className="shrink-0">›</span>
                <Link href={`/learn/${courseId}#skill-map`} className="min-w-0 truncate hover:text-zinc-800 hover:underline dark:hover:text-zinc-200" title={parent.title}>
                  {parent.title}
                </Link>
              </>
            )}
          </nav>
          <h1 className="truncate text-base leading-snug font-semibold sm:text-lg" title={node.title}>
            {node.title}
          </h1>
        </div>
        {status === "mastered" && <span className="shrink-0 text-sm text-emerald-700 dark:text-emerald-400">✓<span className="hidden sm:inline"> {t("mastered")}</span></span>}
        {(node.summary || node.objectives.length > 0) && (
          <details className="relative shrink-0 text-sm">
            <summary className="btn btn-sm cursor-pointer list-none">{t("Goals")}</summary>
            <div className="card absolute top-full right-0 z-20 mt-1 w-[min(32rem,calc(100vw-2rem))] space-y-1 p-3 text-zinc-700 shadow-lg dark:text-zinc-300">
              {node.summary && <p>{node.summary}</p>}
              {node.objectives.length > 0 && (
                <ul className="list-disc pl-5">
                  {node.objectives.map((o, i) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>
              )}
            </div>
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
