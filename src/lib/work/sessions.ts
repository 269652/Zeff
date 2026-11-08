import { isChatTodo } from "@/lib/chat";
import { listTodos, todosByIds } from "@/lib/todos/store";
import { getTicketCards } from "@/lib/jira/store";
import type { WorkRunView } from "./shared";
import { recentRuns, runsByStatus, toRunView } from "./store";
import { archivedSessions } from "./session-admin";

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
  /** Its todo (the conversation's), its branch, and whether you archived it. */
  todoId: number;
  branch: string | null;
  archived: boolean;
};
export type SessionTicket = { ticket: string; summary: string | null; status: string | null; url: string | null; openTodos: number; sessions: SessionItem[]; active: boolean; lastAt: string };

/** `archived`: your archived sessions too (marked so) — else they're left out. */
export function sessionTickets(opts: { archived?: boolean } = {}): SessionTicket[] {
  const put = archivedSessions();
  const runs = [...new Map([...runsByStatus(["queued", "running"]).map(toRunView), ...recentRuns(200)].map((r) => [r.id, r])).values()];
  const todos = todosByIds(runs.map((r) => r.todoId));
  const open = listTodos({ status: "open" }).filter((t) => !t.byWorker); // (a worker's own todos are quiet)
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
  // A session is a conversation: all runs on one todo (each message a run) — shown once, as its newest run.
  const newest = new Map<number, WorkRunView>();
  for (const r of runs) if ((newest.get(r.todoId)?.id ?? 0) < r.id) newest.set(r.todoId, r);
  for (const r of newest.values()) {
    // The chats have their own page (/chat) — not Work's list.
    if (isChatTodo(todos.get(r.todoId))) continue;
    const archived = put.has(r.todoId);
    if (archived && !opts.archived) continue;
    const t = of(r.ticket);
    const live = !!r.live;
    const active = r.status === "queued" || r.status === "running";
    const at = r.startedAt ?? r.queuedAt;
    t.sessions.push({ id: r.id, ref: r.ref, status: r.status, live, waiting: live && (!r.live!.busy || !!r.live!.permission), provider: r.provider, title: todos.get(r.todoId)?.text ?? r.summary ?? r.ref, at, todoId: r.todoId, branch: r.branch, archived });
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
