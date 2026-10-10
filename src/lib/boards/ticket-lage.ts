import { desc, eq } from "drizzle-orm";
import { getDb, getSqlite, schema } from "@/db";
import type { BoardResult, BoardTicket } from "./shared";
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

export function openTodosByTicket(): Map<string, { id: number; text: string; owner: "me" | "other" }[]> {
  const out = new Map<string, { id: number; text: string; owner: "me" | "other" }[]>();
  for (const t of listTodos({ status: "open" }))
    for (const k of [t.ticket, ...t.alsoTickets].filter(Boolean).map((x) => x.toUpperCase())) out.set(k, [...(out.get(k) ?? []), { id: t.id, text: t.text, owner: t.owner }]);
  return out;
}
