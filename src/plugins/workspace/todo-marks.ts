import { getSqlite } from "@/db";
import type { Row } from "./model";

/**
 * What of a database flowed into todos: per row, the todos that refer to it — a mail ("mail:<key>"), any row that comes from a source
 * (its srcref), the row itself ("ws:<id>"), a note's checklist items ("bt:<item>"), a ticket (the todos of its key). Dismissed ones don't
 * count; the messages of one conversation share theirs. The view marks such a row: one todo a dot, several a badge with their number. Server only.
 */

export type TodoMark = { n: number; open: number; /** The first one's text (the dot's tip). */ text: string };

type TodoRow = { id: number; refs: string; ticket: string; status: string; text: string };

export function todoMarks(rows: Row[], dbId: number): Record<number, TodoMark> {
  if (!rows.length) return {};
  const sqlite = getSqlite();
  let todos: TodoRow[];
  try {
    todos = sqlite.prepare("select id, refs, ticket, status, text from todos where status != 'dismissed'").all() as TodoRow[];
  } catch {
    return {};
  }
  if (!todos.length) return {};
  const byRef = new Map<string, TodoRow[]>();
  const byTicket = new Map<string, TodoRow[]>();
  const add = (m: Map<string, TodoRow[]>, k: string, t: TodoRow) => (m.get(k) ?? m.set(k, []).get(k)!).push(t);
  for (const t of todos) {
    let refs: unknown = [];
    try {
      refs = JSON.parse(t.refs);
    } catch {
      refs = [];
    }
    if (Array.isArray(refs)) for (const r of refs) if (typeof r === "string") add(byRef, r, t);
    if (t.ticket) add(byTicket, t.ticket.toUpperCase(), t);
  }
  // A note's checklist items (the Agenda's notes: their items are todos).
  const items = new Map<number, string[]>();
  const withLists = sqlite.prepare("select id, content from ws_pages where db_id = ? and archived_at is null and instr(content, '\"itemId\"') > 0").all(dbId) as { id: number; content: string }[];
  for (const p of withLists) items.set(p.id, [...p.content.matchAll(/"itemId":"([\w-]+)"/g)].map((m) => `bt:${m[1]}`));

  // A conversation's messages (the inbox shows one line per conversation): what flowed into todos from any of them marks each.
  const CONV = ["commconv", "mailconv", "msgconv"];
  const convOf = (r: Row): string => {
    for (const c of CONV) if (typeof r.cells[c] === "string" && r.cells[c]) return `${c}:${String(r.cells[c])}`;
    return "";
  };
  const own = new Map<number, Map<number, TodoRow>>();
  for (const r of rows) {
    const found = new Map<number, TodoRow>();
    const take = (list: TodoRow[] | undefined) => list?.forEach((t) => found.set(t.id, t));
    take(byRef.get(`ws:${r.id}`));
    const src = typeof r.cells.srcref === "string" ? r.cells.srcref : "";
    if (src) take(byRef.get(src));
    for (const ref of items.get(r.id) ?? []) take(byRef.get(ref));
    const ticket = typeof r.cells.ticketkey === "string" ? r.cells.ticketkey.trim().toUpperCase() : "";
    if (ticket) take(byTicket.get(ticket));
    if (found.size) own.set(r.id, found);
  }
  const byConv = new Map<string, Map<number, TodoRow>>();
  for (const r of rows) {
    const conv = convOf(r);
    const found = own.get(r.id);
    if (conv && found) for (const [id, t] of found) (byConv.get(conv) ?? byConv.set(conv, new Map()).get(conv)!).set(id, t);
  }
  const out: Record<number, TodoMark> = {};
  for (const r of rows) {
    const found = byConv.get(convOf(r)) ?? own.get(r.id);
    if (!found?.size) continue;
    const list = [...found.values()].sort((a, b) => a.id - b.id);
    out[r.id] = { n: list.length, open: list.filter((t) => t.status === "open").length, text: list[0].text.slice(0, 120) };
  }
  return out;
}
