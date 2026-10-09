import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";
import { emitChange } from "@/lib/events";
import { listTodos, setTodoOps } from "./store";
import type { TodoOp, TodoView } from "./shared";

/** "Christophers Antwort abwarten", "Auf die Freigabe von X warten": waiting on someone else. */
const WAITS = /(?<!\p{L})abwarten(?!\p{L})|(?<!\p{L})auf\s[^.]{1,80}?\s(zu\s)?warten(?!\p{L})/iu;

/** "mit Christopher Lorenz auf Test prüfen": something done together with a person — their name, and what. */
const TOGETHER = /(?<!\p{L})mit\s+(\p{Lu}[\p{L}-]+(?:\s+\p{Lu}[\p{L}-]+)?)\s+(?:(?:zusammen|gemeinsam)\s+)?([^.]*?(?:prüfen|klären|abstimmen|durchgehen|testen|besprechen|anschauen|ansehen|abnehmen))(?!\p{L})/u;

/** Whether a Teams message to that person went out for it already (its note says so) — then it's theirs to answer. */
const messaged = (t: TodoView, name: string) => !!t.note && /teams/i.test(t.note) && t.note.includes(name.split(" ")[0]);

/**
 * The time-asking message for a todo done with someone: "Hi Christopher, wann hättest du kurz
 * Zeit? Ich würde gern mit dir den Report auf Test prüfen (PROJ-415)." — editable before it's sent.
 */
function askForTime(t: TodoView, name: string, what: string): TodoOp {
  const first = name.split(" ")[0];
  const rest = t.text
    .replace(/\s*mit\s+\p{Lu}[\p{L}-]+(?:\s+\p{Lu}[\p{L}-]+)?\s+/u, " ")
    .replace(/[.!]\s*$/, "")
    .trim();
  const doing = (rest || what).replace(/^\p{Lu}(?=\p{Ll})/u, (c) => c.toLowerCase());
  return { type: "teams-message", to: name, body: `Hi ${first}, wann hättest du kurz Zeit? Ich würde gern mit dir ${doing} (${t.ticket}).` };
}

/**
 * Rules on the open todos, without AI — the same every time, whatever a run wrote:
 * - one that waits on someone ("… abwarten", "auf X warten") is theirs: under "Wartet auf andere";
 * - one done together with someone ("mit X prüfen / klären / abstimmen …") gets a Teams message
 *   to them asking when they have time — unless it has operations, or a message went out already.
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
    const m = TOGETHER.exec(t.text);
    if (t.owner === "me" && !t.ops.length && m && !messaged(t, m[1])) {
      setTodoOps(t.id, [askForTime(t, m[1], m[2])]);
      n++;
    }
  }
  if (n) emitChange("todos");
  return n;
}
