import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { emitChange } from "@/lib/events";
import { t } from "@/lib/i18n/server";
import { getTodo } from "../todos/store";

/** What else a run made and can be taken back (the People plugin's promises and facts): how many went. */
type RunUndoer = (runId: number) => number;
const undoers: RunUndoer[] = [];
export const onRunUndone = (f: RunUndoer): void => void (undoers.includes(f) || undoers.push(f));

/**
 * A Lage run (the Ticket-Lage, the Mail-Durchsicht) taken back: what it made that you haven't touched goes — its open todos with no
 * note of yours, no work on them, not ticked off — dismissed, saying which run made them; the ones you worked on stay. What else it
 * made (the People plugin's promises and facts you haven't looked at) goes with it. Server only.
 */
export function undoLageRun(runId: number): { dismissed: number; kept: number; claims: number } {
  const { todos } = schema;
  const made = getDb().select({ id: todos.id }).from(todos).where(eq(todos.runId, runId)).all();
  let dismissed = 0;
  let kept = 0;
  const now = new Date().toISOString();
  for (const { id } of made) {
    const todo = getTodo(id);
    if (!todo) continue;
    const touched = todo.status !== "open" || todo.userNotes.length > 0 || !!todo.workRunId || !!todo.flaggedAt;
    if (touched) {
      kept++;
      continue;
    }
    getDb()
      .update(todos)
      .set({ status: "dismissed", doneAt: now, updatedAt: now, note: t("Taken back with its run #{run}.", { run: runId }) })
      .where(and(eq(todos.id, id), eq(todos.status, "open")))
      .run();
    dismissed++;
  }
  if (dismissed) emitChange("todos");
  let claims = 0;
  for (const u of undoers) {
    try {
      claims += u(runId);
    } catch (e) {
      console.warn("[run undo]", e instanceof Error ? e.message : e);
    }
  }
  return { dismissed, kept, claims };
}
