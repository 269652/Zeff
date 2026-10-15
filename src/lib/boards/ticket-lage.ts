import { desc, eq } from "drizzle-orm";
import { getDb, getSqlite, schema } from "@/db";
import { sourcesOf, type BoardResult, type BoardTicket, type TodoSource, type TodoUserNote } from "./shared";
import { todoSources } from "./sources";
import { listTodos } from "./store";

/**
 * Each ticket's Lage (Jira's and the Kanban cards'): what the newest runs that analyzed it said —
 * and the open todos by ticket. For the boards that show it on their cards (Jira Lage, Kanban).
 */

const { boardRuns } = schema;

export type Lage = BoardResult["tickets"][number];

/** Each ticket's latest Lage — from the newest runs that analyzed it — and the latest run's lede and time. */
export function lageByTicket(): { byKey: Map<string, Lage>; tickets: BoardTicket[]; lede: string | null; at: string | null } {
  const runs = getDb().select().from(boardRuns).where(eq(boardRuns.status, "ok")).orderBy(desc(boardRuns.id)).limit(12).all();
  const byKey = new Map<string, Lage>();
  for (const r of runs) {
    let res: BoardResult | null = null;
    try {
      res = r.result ? (JSON.parse(r.result) as BoardResult) : null;
    } catch {
      res = null;
    }
    for (const t of res?.tickets ?? []) if (!byKey.has(t.key.toUpperCase())) byKey.set(t.key.toUpperCase(), t);
  }
  const last = runs[0];
  let tickets: BoardTicket[] = [];
  let lede: string | null = null;
  try {
    tickets = last ? (JSON.parse(last.tickets) as BoardTicket[]) : [];
    lede = last?.result ? ((JSON.parse(last.result) as BoardResult).lede ?? null) : null;
  } catch {
    tickets = [];
  }
  // Everyone else's tickets: the Board-Lage (Jira Lage), where the Ticket-Lage has none.
  try {
    for (const r of getSqlite().prepare("select key, result from ticket_lage").all() as { key: string; result: string }[]) {
      const k = r.key.toUpperCase();
      if (byKey.has(k)) continue;
      const v = JSON.parse(r.result) as { attention: string; lead: string; summary: string; happened?: Lage["happened"]; flags?: string[] };
      byKey.set(k, { key: r.key, attention: v.attention as Lage["attention"], lead: v.lead, summary: v.summary, happened: v.happened ?? [], todos: [], resolved: [], flags: v.flags ?? [], actions: [] });
    }
  } catch {
    // no Board-Lage (yet)
  }
  return { byKey, tickets, lede, at: last?.finishedAt ?? last?.startedAt ?? null };
}

/** One piece of a ticket's context: what a todo came from, or a note on one. */
export type TicketContextItem = { s: TodoSource } | { n: TodoUserNote };

/**
 * Each ticket's context, for its card: everything its open todos came from (the Jira comments,
 * mails, Teams and GitLab messages, notes, facts, documents) and the notes on them — each once.
 */
export function contextByTicket(tickets: BoardTicket[] = []): Map<string, TicketContextItem[]> {
  const todos = listTodos({ status: "open" }).filter((t) => !t.byWorker);
  const sources = todos.length ? todoSources(todos, tickets) : {};
  const out = new Map<string, TicketContextItem[]>();
  for (const k of new Set(todos.flatMap((t) => [t.ticket, ...t.alsoTickets]).filter(Boolean).map((x) => x.toUpperCase()))) {
    const mine = todos.filter((t) => [t.ticket, ...t.alsoTickets].some((x) => x.toUpperCase() === k));
    const notes = new Map(mine.flatMap((t) => [...t.userNotes, ...(t.relatedNotes ?? [])]).map((n) => [`${n.at}|${n.text}`, n]));
    out.set(k, [...sourcesOf(mine.flatMap((t) => t.refs), sources).map((s): TicketContextItem => ({ s })), ...[...notes.values()].map((n): TicketContextItem => ({ n }))]);
  }
  return out;
}

/** The tickets the last Ticket-Lage run analyzed (they have their Lage from it: a board review leaves them). */
export function analyzedByTicketLage(): Set<string> {
  const last = getDb().select({ tickets: boardRuns.tickets }).from(boardRuns).where(eq(boardRuns.status, "ok")).orderBy(desc(boardRuns.id)).limit(1).get();
  try {
    return new Set((JSON.parse(last?.tickets ?? "[]") as BoardTicket[]).filter((t) => t.analyzed).map((t) => t.key.toUpperCase()));
  } catch {
    return new Set();
  }
}

export function openTodosByTicket(): Map<string, { id: number; text: string; owner: "me" | "other" }[]> {
  const out = new Map<string, { id: number; text: string; owner: "me" | "other" }[]>();
  for (const t of listTodos({ status: "open" }))
    for (const k of [t.ticket, ...t.alsoTickets].filter(Boolean).map((x) => x.toUpperCase())) out.set(k, [...(out.get(k) ?? []), { id: t.id, text: t.text, owner: t.owner }]);
  return out;
}
