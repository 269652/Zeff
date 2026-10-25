import { getDb, getSqlite, schema } from "@/db";
import { eq } from "drizzle-orm";
import { addManualTodo, getTodo, setTodoDue } from "@/lib/boards/store";
import { euroAmounts, linkedRefs } from "@/lib/boards/todo-settle";
import { isInstalled } from "@/plugins/state";
import { openCommitments } from "./graph";

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
    // In German, like the todos Zeff makes from your mails.
    const euro = amount.toLocaleString("de-DE", { minimumFractionDigits: amount % 1 ? 2 : 0 });
    const g = addManualTodo({ ticket: "", text: `${c.personName} ${euro} € zurückzahlen (zugesagt: „${c.text.slice(0, 200)}“)` });
    if (!g?.id) continue;
    // (The gate may hand back a todo there already, the same in other words: the promise's source added to its own, its due kept.)
    if (c.sourceRef) getDb().update(schema.todos).set({ refs: JSON.stringify([...new Set([...(g.outcome ? g.refs : []), c.sourceRef])]), updatedAt: new Date().toISOString() }).where(eq(schema.todos.id, g.id)).run();
    if (!g.outcome || !g.due) setTodoDue(g.id, c.due);
    sqlite.prepare("insert or ignore into people_promise_todos (claim_id, todo_id, at) values (?, ?, ?)").run(c.id, g.id, new Date().toISOString());
    made.push(g.id);
  }
  return made;
}
