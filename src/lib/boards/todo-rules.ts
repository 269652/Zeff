import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";
import { emitChange } from "@/lib/events";
import { listTodos } from "./store";

/** "Christophers Antwort abwarten", "Auf die Freigabe von X warten": waiting on someone else. */
const WAITS = /(?<!\p{L})abwarten(?!\p{L})|(?<!\p{L})auf\s[^.]{1,80}?\s(zu\s)?warten(?!\p{L})/iu;

/**
 * Rules on the open todos, without AI — the same every time, whatever a run wrote:
 * one that waits on someone ("… abwarten", "auf X warten") is theirs: under "Wartet auf andere".
 * (What to do with a todo — a message, an appointment — is the auto-actions step's.)
 * How many were changed.
 */
export function applyTodoRules(): number {
  let n = 0;
  for (const t of listTodos({ status: "open" })) {
    if (t.owner === "me" && !t.ops.length && WAITS.test(t.text)) {
      getDb().update(schema.todos).set({ owner: "other", updatedAt: new Date().toISOString() }).where(eq(schema.todos.id, t.id)).run();
      n++;
      continue;
    }
  }
  if (n) emitChange("todos");
  return n;
}
