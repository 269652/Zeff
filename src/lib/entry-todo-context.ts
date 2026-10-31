import { eq, inArray } from "drizzle-orm";
import { getDb, getSqlite, schema } from "@/db";
import { sourcesOf, sourceKey, type TodoSource, type TodoUserNote } from "@/lib/todos/shared";
import { todoSources } from "@/lib/todos/sources";
import { lastGoodRun } from "@/lib/runs/store";
import { todosByIds } from "@/lib/todos/store";
import type { TodoView } from "@/lib/todos/shared";

const { todos, workRuns, entrySuggestions, entryContexts, contexts, timeEntries } = schema;

/** Of each kind, at most this many from the ticket's conversations around the day. */
const PER_KIND = 25;

/** The day before and the day itself (local), as ISO bounds: what was said around the work. */
function window(date: string): [string, string] {
  const day = new Date(`${date}T00:00:00`);
  const lo = new Date(day.getTime() - 864e5).toISOString();
  const hi = new Date(day.getTime() + 864e5).toISOString();
  return [lo, hi];
}

/**
 * The ticket's conversations around an entry's day — Jira comments on it, Teams messages, mails
 * and GitLab items that name it — as refs (what todos keep: "jira-comment:<id>", "teams:<key>" …).
 */
function ticketRefs(ticket: string, date: string): string[] {
  const sqlite = getSqlite();
  const [lo, hi] = window(date);
  const like = `%${ticket}%`;
  const keys = (sql: string, ...args: unknown[]) => (sqlite.prepare(sql).all(...args) as { k: string }[]).map((r) => r.k);
  return [
    ...keys(`select id k from jira_comments where upper(ticket) = ? and at >= ? and at < ? order by at desc limit ${PER_KIND}`, ticket, lo, hi).map((k) => `jira-comment:${k}`),
    ...keys(`select key k from teams_messages where sent_at >= ? and sent_at < ? and (text like ? or subject like ?) order by sent_at desc limit ${PER_KIND}`, lo, hi, like, like).map((k) => `teams:${k}`),
    ...keys(`select key k from emails where received_at >= ? and received_at < ? and (subject like ? or preview like ?) order by received_at desc limit ${PER_KIND}`, lo, hi, like, like).map((k) => `mail:${k}`),
    ...keys(`select key k from gitlab_items where coalesce(updated_at, created_at) >= ? and created_at < ? and (title like ? or branch like ? or body like ?) order by created_at desc limit ${PER_KIND}`, lo, hi, like, like, like).map((k) => `gitlab:${k}`),
  ];
}

/**
 * A meeting's (or training's) conversations that day: its Teams meeting chat (the chat is named
 * after it) and the mails about it (invitations, updates, minutes).
 */
function meetingRefs(title: string, date: string): string[] {
  const sqlite = getSqlite();
  const [lo, hi] = window(date);
  const t = title.trim();
  const keys = (sql: string, ...args: unknown[]) => (sqlite.prepare(sql).all(...args) as { k: string }[]).map((r) => r.k);
  return [
    ...keys(`select key k from teams_messages where sent_at >= ? and sent_at < ? and (lower(place) = lower(?) or lower(subject) = lower(?)) order by sent_at desc limit ${PER_KIND}`, lo, hi, t, t).map((k) => `teams:${k}`),
    ...keys(`select key k from emails where received_at >= ? and received_at < ? and subject like ? order by received_at desc limit ${PER_KIND}`, lo, hi, `%${t}%`).map((k) => `mail:${k}`),
  ];
}

const TICKET_KEY = /\b[A-Z][A-Z0-9]+-\d+\b/g;

/** Todos on the ticket that something happened to that day (worked on, done, noted). */
function ticketDayTodos(ticket: string, date: string): number[] {
  const day = new Date(`${date}T00:00:00`);
  const lo = day.toISOString();
  const hi = new Date(day.getTime() + 864e5).toISOString();
  return (getSqlite().prepare(`select distinct todo_id k from todo_events where upper(ticket) = ? and at >= ? and at < ?`).all(ticket, lo, hi) as { k: number }[]).map((r) => r.k);
}

/** What an entry's todos bring along — the same context a todo shows: what they came from, their notes and AI reports. */
export type EntryTodoContext = {
  todos: { id: number; text: string }[];
  /** The work runs booked with it (W-n). */
  runs: number[];
  sources: TodoSource[];
  notes: TodoUserNote[];
};

const ids = (json: string): number[] => {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.map(Number).filter(Number.isInteger) : [];
  } catch {
    return [];
  }
};

/**
 * The todos that flowed into each entry — booked with it, behind its suggestion, worked on in its
 * runs, linked in its context, busy on its ticket that day — and their context, read now (what
 * came since the booking too); and its ticket's conversations around the day (Jira comments,
 * Teams, mails, GitLab), todos or not. Only the entries that have any.
 */
export function entryTodoContext(entryIds: number[]): Record<number, EntryTodoContext> {
  const wanted = [...new Set(entryIds)].filter((n) => n > 0);
  if (!wanted.length) return {};
  const db = getDb();
  const byEntry = new Map<number, { todos: Set<number>; runs: Set<number> }>();
  const of = (e: number) => byEntry.get(e) ?? byEntry.set(e, { todos: new Set(), runs: new Set() }).get(e)!;
  for (const t of db.select({ id: todos.id, entryId: todos.entryId }).from(todos).where(inArray(todos.entryId, wanted)).all()) of(t.entryId!).todos.add(t.id);
  for (const r of db.select({ id: workRuns.id, entryId: workRuns.entryId, todoId: workRuns.todoId }).from(workRuns).where(inArray(workRuns.entryId, wanted)).all()) {
    of(r.entryId!).runs.add(r.id);
    if (r.todoId) of(r.entryId!).todos.add(r.todoId);
  }
  for (const s of db.select({ entryId: entrySuggestions.entryId, todoIds: entrySuggestions.todoIds, runIds: entrySuggestions.runIds }).from(entrySuggestions).where(inArray(entrySuggestions.entryId, wanted)).all()) {
    for (const t of ids(s.todoIds)) of(s.entryId!).todos.add(t);
    for (const r of ids(s.runIds)) of(s.entryId!).runs.add(r);
  }
  // A todo in its context (zeff:todo:<id>).
  // The ticket it's booked on: its todos busy that day, and what was said about it around then.
  const ticketOf = new Map<number, string[]>();
  for (const e of db.select({ id: timeEntries.id, ticket: timeEntries.ticket, date: timeEntries.date, type: timeEntries.type, description: timeEntries.description }).from(timeEntries).where(inArray(timeEntries.id, wanted)).all()) {
    // Its ticket, and those its words name.
    const tickets = [...new Set([e.ticket?.trim().toUpperCase(), ...(e.description.match(TICKET_KEY) ?? [])].filter((k): k is string => !!k))];
    const refs: string[] = [];
    for (const ticket of tickets) {
      for (const t of ticketDayTodos(ticket, e.date)) of(e.id).todos.add(t);
      refs.push(...ticketRefs(ticket, e.date));
    }
    // A meeting (or anything) without a ticket: its chat and its mails that day.
    if (!tickets.length && e.description.trim().length >= 4) refs.push(...meetingRefs(e.description, e.date));
    if (refs.length) {
      of(e.id);
      ticketOf.set(e.id, refs);
    }
  }
  for (const c of db.select({ entryId: entryContexts.entryId, links: contexts.links }).from(entryContexts).innerJoin(contexts, eq(contexts.id, entryContexts.contextId)).where(inArray(entryContexts.entryId, wanted)).all()) {
    for (const m of (c.links ?? "").matchAll(/zeff:todo:(\d+)/g)) of(c.entryId).todos.add(Number(m[1]));
  }
  const all = todosByIds([...byEntry.values()].flatMap((v) => [...v.todos]));
  // The ticket's conversations as a todo of their own would have them.
  const asTodo = (refs: string[]) => ({ refs }) as unknown as TodoView;
  const from = todoSources([...all.values(), ...[...ticketOf.values()].map(asTodo)], lastGoodRun()?.tickets ?? []);
  const out: Record<number, EntryTodoContext> = {};
  for (const [entryId, v] of byEntry) {
    const list = [...v.todos].map((id) => all.get(id)).filter((t) => !!t);
    const extra = ticketOf.get(entryId) ?? [];
    if (!list.length && !v.runs.size && !extra.length) continue;
    const seen = new Set<string>();
    const sources = [...list.flatMap((t) => t.refs), ...extra]
      .flatMap((r) => sourcesOf([r], from))
      .filter((s) => !seen.has(sourceKey(s)) && !!seen.add(sourceKey(s)));
    const noteSeen = new Set<string>();
    const notes = list
      .flatMap((t) => [...t.userNotes, ...(t.relatedNotes ?? [])])
      .filter((n) => {
        const k = `${n.from ?? ""}:${n.at}:${n.text.slice(0, 40)}`;
        return !noteSeen.has(k) && !!noteSeen.add(k);
      });
    if (!list.length && !v.runs.size && !sources.length) continue;
    out[entryId] = { todos: list.map((t) => ({ id: t.id, text: t.text })), runs: [...v.runs].sort((a, b) => a - b), sources, notes };
  }
  return out;
}
