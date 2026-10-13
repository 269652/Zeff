import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { emitChange } from "@/lib/events";
import { mergeInto } from "./merge";
import { repeatsByRecord, similarText } from "./similar";
import { linkTodoTicket, listTodos } from "./store";
import type { TodoView } from "./shared";

export type DuplicatePair = { survivor: string; merged: string };

/** Whether two open todos are the same thing: the existing rules (duplicateTodo), words alike on another ticket only with some weight. */
function twin(a: TodoView, b: TodoView): boolean {
  if (a.owner !== b.owner || a.byWorker !== b.byWorker) return false; // yours and someone else's move, yours and a worker's: not one
  if (repeatsByRecord({ text: b.text, ops: b.ops }, a)) return true; // the same message / numbers: the same anywhere
  if (!similarText(a.text, b.text)) return false;
  // By words alone: on its own ticket only (the same words on two tickets can be two jobs; the Ticket-Lage links those it knows are one).
  return a.ticket === b.ticket || a.alsoTickets.includes(b.ticket) || b.alsoTickets.includes(a.ticket);
}

/**
 * The duplicates among the open todos: each one repeating an older one (by the gate's rules, never across owner
 * me / other, nor yours / a worker's) merges into the OLDEST of its kind - that one keeps its id. \`dryRun\`
 * only counts: the pairs ("T-12" absorbs "T-30"). Todos a work run is busy with are left alone.
 */
export function mergeDuplicateTodos(opts: { dryRun?: boolean; actor?: string } = {}): { pairs: DuplicatePair[]; merged: number } {
  const busy = new Set(
    getDb()
      .select({ todoId: schema.workRuns.todoId })
      .from(schema.workRuns)
      .where(inArray(schema.workRuns.status, ["queued", "running"]))
      .all()
      .map((r) => r.todoId),
  );
  const survivors: TodoView[] = [];
  const plan = new Map<number, number[]>(); // survivor → merged
  for (const t of listTodos({ status: "open" })) {
    const into = busy.has(t.id) ? undefined : survivors.find((s) => !busy.has(s.id) && twin(s, t));
    if (into) plan.set(into.id, [...(plan.get(into.id) ?? []), t.id]);
    else survivors.push(t);
  }
  const ref = (id: number) => `T-${id}`;
  const pairs = [...plan].flatMap(([s, ls]) => ls.map((l) => ({ survivor: ref(s), merged: ref(l) })));
  if (opts.dryRun || !pairs.length) return { pairs, merged: 0 };
  let merged = 0;
  getDb().transaction(() => {
    for (const [s, ls] of plan) {
      const survivor = survivors.find((x) => x.id === s)!;
      for (const l of ls) {
        const other = getDb().select({ ticket: schema.todos.ticket }).from(schema.todos).where(eq(schema.todos.id, l)).get();
        if (!mergeInto(s, l, opts.actor ?? "merge")) continue;
        if (other?.ticket && other.ticket !== survivor.ticket) linkTodoTicket(s, other.ticket);
        merged++;
      }
    }
  });
  if (merged) emitChange("todos");
  return { pairs, merged };
}
