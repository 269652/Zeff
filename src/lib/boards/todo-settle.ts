import { getSqlite } from "@/db";
import { withCause } from "@/lib/cause";
import { onTodoDone, onTodoReopened } from "./done-hooks";
import type { TodoView } from "./shared";
import { getTodo } from "./store";

/**
 * What hangs on a todo: the things it comes from and settles when it is done — a case's instalment, a promise you made, a debt —
 * named by refs ("case:3", "claim:44", "debt:3442"). The plugins say how to find them (from the todo itself: its sources, its
 * transfer; and from what was found before — a debt from the promise it was written down from) and what settling one means. A todo
 * ticked off settles each once (kept: which todo settled what, and how it was before), so every view can depend on it; opened again,
 * each is taken back. What settling writes is caused by the todo ("T-130" in a row's history). The core knows none of them. Server only.
 */

type Finder = (todo: TodoView, found: readonly string[]) => string[];
/**
 * Settles a ref for a todo done (its amount, when it says one; everything found on it): false — nothing to settle; true — settled;
 * { undo } — settled, and how it was before (kept, handed to the kind's unsettler when the todo is opened again).
 */
type Settler = (ref: string, todo: TodoView, amount: number | null, found: readonly string[]) => boolean | { undo: unknown };
/** Takes back what settling a ref did — with what the settler kept. */
type Unsettler = (ref: string, undo: unknown, todoId: number) => void;

const finders: Finder[] = [];
const settlers = new Map<string, Settler>();
const unsettlers = new Map<string, Unsettler>();

/** A plugin's way to find what hangs on a todo. Finders run in turn until nothing new is found (a debt from a promise found before). */
export const todoLinkFinder = (f: Finder): void => void (finders.includes(f) || finders.push(f));
/** What settling a ref of this kind ("case", "claim" …) means. */
export const todoSettler = (kind: string, s: Settler, undo?: Unsettler): void => {
  settlers.set(kind, s);
  if (undo) unsettlers.set(kind, undo);
};

/** Everything that hangs on the todo, in the order found (what a settler of a later one may need settled first). */
export function linkedRefs(todo: TodoView): string[] {
  const found: string[] = [];
  for (let round = 0; round < 4; round++) {
    let more = false;
    for (const f of finders) {
      let refs: string[] = [];
      try {
        refs = f(todo, found);
      } catch (e) {
        console.warn("[todo links]", e instanceof Error ? e.message : e);
      }
      for (const r of refs) if (!found.includes(r)) (found.push(r), (more = true));
    }
    if (!more) break;
  }
  return found;
}

let hasUndo = false;

function table() {
  const sqlite = getSqlite();
  sqlite.exec("create table if not exists todo_settled (todo_id integer not null, ref text not null, at text not null, primary key (todo_id, ref))");
  // (How it was before came later: added to a table from before.)
  if (!hasUndo) {
    if (!(sqlite.prepare("pragma table_info(todo_settled)").all() as { name: string }[]).some((c) => c.name === "undo")) sqlite.exec("alter table todo_settled add column undo text");
    hasUndo = true;
  }
  return sqlite;
}

/** The euro amounts a text names ("40 € und 20 €" → [40, 20]; "3.618,13 €" → 3618.13), in order. */
export function euroAmounts(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:€|eur\b|euro\b)/gi)) {
    const n = Number(m[1].includes(",") ? m[1].replace(/\./g, "").replace(",", ".") : /\.\d{3}$/.test(m[1]) ? m[1].replace(/\./g, "") : m[1]);
    if (Number.isFinite(n) && n > 0) out.push(Math.round(n * 100) / 100);
  }
  return out;
}

const opAmount = (todo: Pick<TodoView, "ops">): number | null => {
  const op = todo.ops.find((o) => (o.type === "bank-transfer" || o.type === "revolut-pay") && Number((o as { amount?: unknown }).amount) > 0) as { amount?: unknown } | undefined;
  return op ? Math.round(Number(op.amount) * 100) / 100 : null;
};

/** The money a todo pays: its transfer's amount, else the first euro amount it names. Null: none. */
export function todoAmount(todo: Pick<TodoView, "text" | "ops">): number | null {
  return opAmount(todo) ?? euroAmounts(todo.text)[0] ?? null;
}

/** Every amount a todo names — its transfer's and those in its text ("40 € und 20 €"): what a promise's amount is matched against. */
export function todoAmounts(todo: Pick<TodoView, "text" | "ops">): number[] {
  const op = opAmount(todo);
  return [...new Set([...(op != null ? [op] : []), ...euroAmounts(todo.text)])];
}

/** A todo done: each thing hanging on it settled — once, however often it is ticked. The refs settled now. */
export function settleLinked(todoId: number): string[] {
  const todo = getTodo(todoId);
  if (!todo) return [];
  const sqlite = table();
  const amount = todoAmount(todo);
  const now: string[] = [];
  const found = linkedRefs(todo);
  for (const ref of found) {
    if (sqlite.prepare("select 1 from todo_settled where todo_id = ? and ref = ?").get(todoId, ref)) continue;
    const settle = settlers.get(ref.split(":")[0]);
    if (!settle) continue;
    let r: ReturnType<Settler>;
    try {
      r = withCause(todo.ref, () => settle(ref, todo, amount, found));
    } catch (e) {
      console.warn(`[todo links] ${ref}:`, e instanceof Error ? e.message : e);
      continue;
    }
    if (r === false) continue;
    const undo = typeof r === "object" ? JSON.stringify(r.undo ?? null) : null;
    sqlite.prepare("insert or ignore into todo_settled (todo_id, ref, at, undo) values (?, ?, ?, ?)").run(todoId, ref, new Date().toISOString(), undo);
    now.push(ref);
  }
  return now;
}

/** Which todos settled a thing, and when — for a view to say "done by …". */
export const settledBy = (ref: string): { todoId: number; at: string }[] =>
  (table().prepare("select todo_id todoId, at from todo_settled where ref = ? order by at").all(ref) as { todoId: number; at: string }[]).map((r) => ({ ...r }));

/** A done todo opened again: what it settled taken back, newest first (a debt before the promise it came from). The refs taken back. */
export function unsettleLinked(todoId: number): string[] {
  const sqlite = table();
  const rows = sqlite.prepare("select ref, undo from todo_settled where todo_id = ? order by rowid desc").all(todoId) as { ref: string; undo: string | null }[];
  const back: string[] = [];
  const ref = getTodo(todoId)?.ref ?? `T-${todoId}`;
  for (const r of rows) {
    const undo = unsettlers.get(r.ref.split(":")[0]);
    try {
      if (undo) withCause(ref, () => undo(r.ref, r.undo ? JSON.parse(r.undo) : null, todoId));
    } catch (e) {
      console.warn(`[todo links] back ${r.ref}:`, e instanceof Error ? e.message : e);
      continue;
    }
    sqlite.prepare("delete from todo_settled where todo_id = ? and ref = ?").run(todoId, r.ref);
    back.push(r.ref);
  }
  return back;
}

onTodoDone((id) => void settleLinked(id));
onTodoReopened((id) => void unsettleLinked(id));
