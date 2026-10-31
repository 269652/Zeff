import { getDb, getSqlite, schema } from "@/db";
import { eq } from "drizzle-orm";
import { addManualTodo, getTodo, setTodoDue } from "@/lib/todos/store";
import { euroAmounts, linkedRefs } from "@/lib/todos/settle";
import { isInstalled } from "@/plugins/state";
import { openCommitments, type Claim } from "./graph";

/**
 * A promise of yours to pay, due (in three days or past it) and with no todo yet: a todo for it, once — where the promise was made as
 * its source, its due date as the todo's. Ticked off, it keeps the promise and pays the debt written down from it (todo-settle.ts).
 * The Mail-Durchsicht makes most of these todos itself; this catches the ones it did not (a promise in a chat it read as a fact). Server only.
 */

const SOON_DAYS = 3;
/** A plan of instalments: its todos come from its debt, not from the promise. */
const PLAN = /\braten(?:plan)?\b|monatlich|\bà\s*\d|je(?:weils)?\s+\d+\s*€/i;

function table() {
  const sqlite = getSqlite();
  sqlite.exec("create table if not exists people_promise_todos (claim_id integer primary key, todo_id integer not null, at text not null)");
  return sqlite;
}

/** Whether a todo there is (open or done) that this promise hangs on — the Mail-Durchsicht's, from the same message. */
function hasTodo(claimId: number, sourceRef: string): boolean {
  if (!sourceRef) return false;
  const rows = getSqlite().prepare("select id from todos where refs like ? and status != 'dismissed'").all(`%${sourceRef.replace(/[%_]/g, "")}%`) as { id: number }[];
  return rows.some((r) => {
    const todo = getTodo(r.id);
    return !!todo && linkedRefs(todo).includes(`claim:${claimId}`);
  });
}

/** The todos made now for the promises due without one. Their ids. */
export function promiseTodos(today = new Date().toLocaleDateString("sv-SE")): number[] {
  if (!isInstalled("people") || !isInstalled("todos")) return [];
  const sqlite = table();
  const until = new Date(new Date(`${today}T12:00:00`).getTime() + SOON_DAYS * 864e5).toLocaleDateString("sv-SE");
  const made: number[] = [];
  for (const c of openCommitments()) {
    if (c.direction !== "mine" || !c.due || c.due > until || PLAN.test(c.text)) continue;
    const amount = euroAmounts(c.text)[0];
    if (amount == null) continue;
    if (sqlite.prepare("select 1 from people_promise_todos where claim_id = ?").get(c.id)) continue;
    if (hasTodo(c.id, c.sourceRef)) continue;
    const id = todoForPromise(c);
    if (id) made.push(id);
  }
  return made;
}

/**
 * A todo for a promise (of yours, or one made to you — to remind them), once: where it was made as its source, its day as the todo's.
 * A promise to pay reads as the payment ("Johanna 200 € zurückzahlen"); any other as itself. The todo's id (one there already: that one).
 */
export function todoForPromise(c: Pick<Claim, "id" | "text" | "due" | "sourceRef" | "direction"> & { personName: string }): number | null {
  const sqlite = table();
  const had = sqlite.prepare("select todo_id from people_promise_todos where claim_id = ?").get(c.id) as { todo_id: number } | undefined;
  if (had && getTodo(had.todo_id)) return had.todo_id;
  const amount = euroAmounts(c.text)[0];
  // In German, like the todos Zeff makes from your mails.
  const euro = amount != null ? amount.toLocaleString("de-DE", { minimumFractionDigits: amount % 1 ? 2 : 0 }) : "";
  const text =
    c.direction === "theirs"
      ? `${c.personName} erinnern: „${c.text.slice(0, 200)}“`
      : amount != null && !PLAN.test(c.text)
        ? `${c.personName} ${euro} € zurückzahlen (zugesagt: „${c.text.slice(0, 200)}“)`
        : `${c.personName}: ${c.text.slice(0, 240)}`;
  const g = addManualTodo({ ticket: "", text });
  if (!g?.id) return null;
  // (The gate may hand back a todo there already, the same in other words: the promise's source added to its own, its due kept.)
  if (c.sourceRef) getDb().update(schema.todos).set({ refs: JSON.stringify([...new Set([...(g.outcome ? g.refs : []), c.sourceRef])]), updatedAt: new Date().toISOString() }).where(eq(schema.todos.id, g.id)).run();
  if (c.due && (!g.outcome || !g.due)) setTodoDue(g.id, c.due);
  sqlite.prepare("insert or ignore into people_promise_todos (claim_id, todo_id, at) values (?, ?, ?)").run(c.id, g.id, new Date().toISOString());
  return g.id;
}
