import { listTodos, todosByIds } from "@/lib/boards/store";
import { getTicketCards } from "@/lib/jira/store";
import type { WorkRunView } from "./shared";
import { recentRuns, runsByStatus, toRunView } from "./store";

/**
 * Work as sessions (like Claude Code): every ticket with work on it — its sessions (the workers'
 * runs, live ones you can talk to) and its open todos — newest first, the ones at work on top.
 */

export type SessionItem = {
  id: number;
  ref: string;
  status: WorkRunView["status"];
  /** A live (interactive) session: at work, or waiting for you (a question, a permission). */
  live: boolean;
  waiting: boolean;
  provider: WorkRunView["provider"];
  title: string;
  at: string;
};
export type SessionTicket = { ticket: string; summary: string | null; status: string | null; url: string | null; openTodos: number; sessions: SessionItem[]; active: boolean; lastAt: string };

export function sessionTickets(): SessionTicket[] {
  const runs = [...new Map([...runsByStatus(["queued", "running"]).map(toRunView), ...recentRuns(200)].map((r) => [r.id, r])).values()];
  const todos = todosByIds(runs.map((r) => r.todoId));
  const open = listTodos({ status: "open" });
  const keys = [...new Set([...runs.map((r) => r.ticket), ...open.map((t) => t.ticket)])];
  const cards = getTicketCards(keys.filter(Boolean));
  const out = new Map<string, SessionTicket>();
  const of = (ticket: string) => {
    const k = ticket.toUpperCase();
    let t = out.get(k);
    if (!t) {
      const c = cards[k];
      t = { ticket: k, summary: c?.summary ?? null, status: c?.status ?? null, url: c?.url ?? null, openTodos: 0, sessions: [], active: false, lastAt: "" };
      out.set(k, t);
    }
    return t;
  };
  for (const r of runs) {
    const t = of(r.ticket);
    const live = !!r.live;
    const active = r.status === "queued" || r.status === "running";
    const at = r.startedAt ?? r.queuedAt;
    t.sessions.push({ id: r.id, ref: r.ref, status: r.status, live, waiting: live && (!r.live!.busy || !!r.live!.permission), provider: r.provider, title: todos.get(r.todoId)?.text ?? r.summary ?? r.ref, at });
    t.active ||= active;
    if (at > t.lastAt) t.lastAt = at;
  }
  for (const td of open) {
    const t = of(td.ticket);
    t.openTodos++;
    if (td.updatedAt > t.lastAt) t.lastAt = td.updatedAt;
  }
  for (const t of out.values()) t.sessions.sort((a, b) => b.at.localeCompare(a.at));
  return [...out.values()].sort((a, b) => Number(b.active) - Number(a.active) || b.lastAt.localeCompare(a.lastAt));
}
