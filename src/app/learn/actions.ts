"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";

type Ok<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const guard = () => {
  if (!isInstalled("learn")) throw new Error(t("The Learn plugin is not installed."));
};

// A new course: POST /api/learn/courses (a route — a page older than the server still reaches it).

export async function retryResearchAction(id: number): Promise<Ok> {
  try {
    guard();
    const { startResearch } = await import("@/plugins/learn/research");
    startResearch(Number(id));
    revalidatePath(`/learn/${id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function deleteCourseAction(id: number): Promise<Ok> {
  try {
    guard();
    const store = await import("@/plugins/learn/store");
    store.deleteCourse(Number(id));
    const { syncStudyCalendar } = await import("@/plugins/learn/schedule");
    await syncStudyCalendar();
    revalidatePath("/learn");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function setInterestsAction(id: number, weights: Record<string, number>): Promise<Ok> {
  try {
    guard();
    (await import("@/plugins/learn/store")).setInterests(Number(id), weights ?? {});
    revalidatePath(`/learn/${id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function setDailyGoalAction(id: number, xp: number): Promise<Ok> {
  try {
    guard();
    (await import("@/plugins/learn/store")).setDailyGoal(Number(id), Number(xp));
    revalidatePath(`/learn/${id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function setStudySlotsAction(id: number, slots: unknown): Promise<Ok> {
  try {
    guard();
    await (await import("@/plugins/learn/schedule")).setStudySlots(Number(id), slots);
    revalidatePath(`/learn/${id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/**
 * A step's lesson: its chat with the teacher — the one there is (its newest run), else a new live session on the
 * step's own todo. Its run, for the lesson page.
 */
export async function startLessonAction(courseId: number, key: string): Promise<Ok<{ runId: number }>> {
  try {
    guard();
    const store = await import("@/plugins/learn/store");
    const { addLessonTodo } = await import("@/plugins/learn/teacher");
    const { runsForTodos } = await import("@/lib/work/store");
    const node = store.getNode(Number(courseId), String(key));
    if (!node) return { ok: false, error: t("That step doesn't exist any more.") };
    if (store.courseTree(Number(courseId)).tree.status.get(node.key) === "locked") return { ok: false, error: t("This step is still locked: master what it requires first.") };
    if (node.lessonTodoId) {
      const newest = runsForTodos([node.lessonTodoId]).get(node.lessonTodoId)?.[0];
      if (newest) return { ok: true, runId: newest.id };
    }
    const todoId = node.lessonTodoId ?? addLessonTodo(Number(courseId), node.key);
    const { startSessionAction } = await import("@/plugins/work/server-actions");
    const r = await startSessionAction({ instruction: t("Let's begin: “{step}”.", { step: node.title }), todoId, provider: "claude", session: { permissionMode: "default" } });
    revalidatePath(`/learn/${courseId}`);
    return r.ok ? { ok: true, runId: r.runId } : r;
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
