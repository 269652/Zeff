/**
 * Learning in your day: study times as appointments in a calendar of their own ("Learning" — busy, no booking, no
 * todos of its own), and the cards due as one todo per course ("Review 12 cards · French") that follows the count and
 * is done when they are. Server only (studyEvents and cleanSlots are pure).
 */
import { getDb, schema } from "@/db";
import { localDay } from "@/lib/dates";
import { t } from "@/lib/i18n/server";
import { getTodo, setTodoStatus, setTodoText } from "@/lib/todos/store";
import { dueCount, listCourses, setCourseSlots, setReviewTodo } from "./store";
import { cleanSlots, studyEvents, WEEKS, type StudySlot } from "./schedule-shared";

export { cleanSlots, studyEvents };

export const LEARN_CALENDAR_KEY = "zeff:learn";

/** The learning calendar from today, for all courses' slots. */
export async function syncStudyCalendar(now: Date = new Date()): Promise<void> {
  const ir = await import("@/lib/calendar/ir");
  const courses = listCourses().filter((c) => c.slots.length);
  const cal = ir.ensureCalendar(LEARN_CALENDAR_KEY, { source: "zeff", name: "Learning", color: "#8b5cf6", busy: true, book: false, todos: false });
  const from = localDay(now);
  const to = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + WEEKS * 7));
  ir.replaceEvents(cal.id, studyEvents(courses.map((c) => ({ id: c.id, title: c.title, slots: c.slots })), now), { from, to });
}

/** A course's study times — and the calendar after them. */
export async function setStudySlots(courseId: number, raw: unknown, now: Date = new Date()): Promise<StudySlot[]> {
  const slots = cleanSlots(raw);
  setCourseSlots(courseId, slots);
  await syncStudyCalendar(now);
  return slots;
}

/** Reviews due → a todo per course (made, its count kept up to date, done when none are due). */
export function syncReviewTodos(now: Date = new Date()): void {
  const due = new Map(dueCount(now).map((d) => [d.courseId, d.due]));
  for (const c of listCourses()) {
    const n = due.get(c.id) ?? 0;
    const todo = c.reviewTodoId ? getTodo(c.reviewTodoId) : undefined;
    const open = todo?.status === "open" ? todo : undefined;
    if (!n) {
      if (open) setTodoStatus(open.id, "done", t("All cards reviewed."));
      continue;
    }
    const text = t("Review {n} cards · {course}", { n, course: c.title });
    if (open) {
      if (open.text !== text) setTodoText(open.id, text);
      continue;
    }
    setReviewTodo(c.id, addReviewTodo(text, localDay(now)));
  }
}

function addReviewTodo(text: string, due: string): number {
  const now = new Date().toISOString();
  return getDb()
    .insert(schema.todos)
    .values({ ticket: "", text, kind: "other", owner: "me", status: "open", source: "Learn", refs: "[]", runId: null, due, createdAt: now, updatedAt: now })
    .returning({ id: schema.todos.id })
    .get().id;
}
