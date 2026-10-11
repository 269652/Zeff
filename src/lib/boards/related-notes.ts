import { listTodos } from "./store";
import type { TodoUserNote, TodoView } from "./shared";

/**
 * The notes on todos related to each one — the steps before it (its parents), and the todos on
 * its ticket about the same comments and messages (refs) — marked with the todo they're on.
 * Only todos that have any.
 */
export function relatedNotes(list: TodoView[]): Record<number, TodoUserNote[]> {
  const out: Record<number, TodoUserNote[]> = {};
  const byTicket = new Map<string, TodoView[]>();
  for (const t of list) {
    if (!byTicket.has(t.ticket)) byTicket.set(t.ticket, listTodos({ ticket: t.ticket, status: "all" }));
    const all = byTicket.get(t.ticket)!;
    const byId = new Map(all.map((x) => [x.id, x]));
    const related = new Set<number>();
    for (let p = t.parentId, n = 0; p && n < 10; p = byId.get(p)?.parentId ?? null, n++) related.add(p);
    const refs = new Set(t.refs);
    if (refs.size) for (const x of all) if (x.id !== t.id && x.refs.some((r) => refs.has(r))) related.add(x.id);
    related.delete(t.id);
    const notes = [...related].flatMap((id) => (byId.get(id)?.userNotes ?? []).map((n) => ({ ...n, from: id })));
    if (notes.length) out[t.id] = notes;
  }
  return out;
}
