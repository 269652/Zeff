import { mailLink } from "@/lib/mail/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { jiraCommentUrl, sourcesOf, todoRef } from "@/lib/boards/shared";
import { todoSources } from "@/lib/boards/sources";
import { lastGoodRun, listTodos, todosByIds } from "@/lib/boards/store";
import { resolveLinks } from "@/lib/context-links";
import { addSource, reorderEntryContexts } from "@/lib/contexts";
import { timeLink, todoLink, workLink } from "@/lib/entities-shared";
import { createEntry } from "@/lib/entries";
import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { round2 } from "@/lib/format";
import { gitlabCommentsByTicket } from "@/lib/gitlab/store";
import { getJiraTicket, getTicketDefaultJob } from "@/lib/jira/store";
import { getJobByNumber } from "@/lib/jobs";
import { isoDate } from "@/lib/week";
import { sideTodos } from "./actions";
import { suggestedEvidence } from "./suggestions";
import { listTodoTimes, markTimeBooked } from "./todo-time";

const { todos, workRuns } = schema;

/** Booked time: quarter hours, rounded up — at least one. */
const quarters = (ms: number) => Math.max(0.25, Math.ceil(ms / 900000) * 0.25);

/** One line of the time behind a group's hours: a record somebody reported, a run's duration, or a quarter for a todo done by hand. */
export type TimeLine = {
  /** The todo, "T-12". */
  todo: string;
  minutes: number;
  note: string;
  by: string;
  at: string | null;
  kind: "record" | "run" | "hand";
  /** The record's id, or the run's. */
  id?: number;
};

/** A ticket's todos done today, as one entry to book: on its job, their time, their lines. */
export type DoneToday = {
  ticket: string;
  summary: string | null;
  job: { id: number; number: string; name: string } | null;
  todoIds: number[];
  todos: { ref: string; text: string }[];
  /** All the time of the todos and the ones related to them (quarter hours, rounded up on the total) plus a quarter per todo done by hand. */
  hours: number;
  description: string;
  /** What the hours add up from. */
  time: TimeLine[];
};

/**
 * The todos that belong to an entry together with this one (itself included): the others on its
 * ticket, its follow-up chain (the todo it follows up on, and what followed it), and the todos a
 * session touched along with it (its side todos — or, from one of those, the session's own).
 */
export function relatedTodoIds(todoId: number): number[] {
  const db = getDb();
  const own = db.select({ id: todos.id, ticket: todos.ticket, parentId: todos.parentId }).from(todos).where(eq(todos.id, todoId)).get();
  if (!own) return [todoId];
  const out = new Set<number>([todoId]);
  for (const r of db.select({ id: todos.id }).from(todos).where(eq(todos.ticket, own.ticket)).all()) out.add(r.id);
  // Up the chain, then down it (a loop guard: a chain is short, a cycle is a bug).
  for (let at = own.parentId, i = 0; at && !out.has(at) && i < 50; i++) {
    out.add(at);
    at = db.select({ parentId: todos.parentId }).from(todos).where(eq(todos.id, at)).get()?.parentId ?? null;
  }
  for (let frontier = [todoId], i = 0; frontier.length && i < 50; i++) {
    const kids = db.select({ id: todos.id }).from(todos).where(inArray(todos.parentId, frontier)).all().map((r) => r.id).filter((id) => !out.has(id));
    for (const id of kids) out.add(id);
    frontier = kids;
  }
  // The sessions: the runs on it — and the side todos they began; from a side todo, the session it was part of.
  const runs = db.select({ id: workRuns.id, provider: workRuns.provider, model: workRuns.model }).from(workRuns).where(inArray(workRuns.todoId, [...out])).all();
  const sessions = new Set(runs.map((r) => r.id));
  for (const r of runs) {
    const m = r.provider === "agent" ? /^W-(\d+) · Session$/.exec(r.model ?? "") : null;
    if (m) {
      sessions.add(Number(m[1]));
      const host = db.select({ todoId: workRuns.todoId }).from(workRuns).where(eq(workRuns.id, Number(m[1]))).get();
      if (host) out.add(host.todoId);
    }
  }
  for (const s of sideTodos([...sessions])) out.add(s.todoId);
  return [...out];
}

/**
 * The time behind one entry's hours: the records of the group's todos and of the todos related
 * to them (not booked, not in a suggestion), else — a todo without agent records — its runs'
 * durations; a todo done by hand gets a quarter. A run a record was made in is never counted
 * besides it. `runs`: the group's finished runs not booked or suggested.
 */
export function groupTime(list: { id: number; text: string }[], runs: (typeof workRuns.$inferSelect)[], suggested: ReturnType<typeof suggestedEvidence>) {
  const ids = list.map((todo) => todo.id);
  const related = new Set(ids.flatMap(relatedTodoIds));
  // Not the ones marked not to be booked (-1) — and not the group's own, which are in it anyway.
  const extra = related.size
    ? getDb().select({ id: todos.id, entryId: todos.entryId }).from(todos).where(inArray(todos.id, [...related])).all().filter((r) => r.entryId !== -1 && !ids.includes(r.id)).map((r) => r.id)
    : [];
  const everything = listTodoTimes([...ids, ...extra]);
  const records = everything.filter((r) => r.entryId == null && !suggested.timeIds.has(r.id));
  const lines: TimeLine[] = records.map((r) => ({ todo: r.todo, minutes: r.minutes, note: r.note, by: r.by, at: r.at, kind: "record", id: r.id }));
  const counted: (typeof runs) = [];
  const byHand: { id: number; text: string }[] = [];
  for (const todo of list) {
    const mine = runs.filter((r) => r.todoId === todo.id);
    const hasAgent = records.some((r) => r.todoId === todo.id && r.source === "agent");
    const made = new Set(everything.filter((r) => r.todoId === todo.id && r.runId != null).map((r) => r.runId));
    if (!hasAgent) counted.push(...mine.filter((r) => !made.has(r.id)));
    if (!mine.length && !records.some((r) => r.todoId === todo.id)) byHand.push(todo);
  }
  for (const r of counted) lines.push({ todo: todoRef(r.todoId), minutes: Math.round((r.durationMs ?? 0) / 60000), note: r.entryLine?.trim() ?? "", by: r.model ?? r.provider, at: r.startedAt, kind: "run", id: r.id });
  for (const todo of byHand) lines.push({ todo: todoRef(todo.id), minutes: 15, note: "", by: "", at: null, kind: "hand" });
  const ms = records.reduce((a, r) => a + r.minutes * 60000, 0) + counted.reduce((a, r) => a + (r.durationMs ?? 0), 0);
  const hours = round2((ms ? quarters(ms) : 0) + byHand.length * 0.25);
  return { lines, hours, timeIds: records.map((r) => r.id), counted, byHand, records };
}

/**
 * The todos done today and not booked yet, by ticket — each an entry to book: the time reported
 * on them and the todos related to them (records; else the workers' runs; a quarter hour for
 * each done by hand), their lines (the entry lines and notes, else the todos' texts) as the
 * description, the ticket's job.
 */
export function doneToday(): DoneToday[] {
  const today = isoDate(new Date());
  const done = listTodos({ status: "done" }).filter(
    (todo) => todo.doneAt && isoDate(new Date(todo.doneAt)) === today,
  );
  if (!done.length) return [];
  // What an agent suggested a booking for already (a shadow row of its own): not here again.
  const suggested = suggestedEvidence();
  const unbooked = new Set(
    getDb()
      .select({ id: todos.id })
      .from(todos)
      .where(
        and(
          inArray(
            todos.id,
            done.map((todo) => todo.id),
          ),
          isNull(todos.entryId),
        ),
      )
      .all()
      .map((r) => r.id)
      .filter((id) => !suggested.todoIds.has(id)),
  );
  const runs = getDb()
    .select()
    .from(workRuns)
    .where(
      and(
        inArray(workRuns.todoId, [...unbooked]),
        eq(workRuns.status, "done"),
        isNull(workRuns.entryId),
      ),
    )
    .all()
    .filter((r) => !suggested.runIds.has(r.id));
  const byTicket = new Map<string, typeof done>();
  for (const todo of done)
    if (unbooked.has(todo.id))
      byTicket.set(todo.ticket, [...(byTicket.get(todo.ticket) ?? []), todo]);
  return [...byTicket.entries()].map(([ticket, list]) => {
    const theirs = runs.filter((r) => list.some((todo) => todo.id === r.todoId));
    const time = groupTime(list, theirs, suggested);
    const lines = [
      ...new Set([
        ...theirs
          .map((r) => r.entryLine?.trim())
          .filter((l): l is string => !!l),
        ...time.records.map((r) => r.note.trim()).filter(Boolean),
        ...time.byHand.map((todo) => todo.text.trim()),
      ]),
    ];
    const text = lines.join("; ");
    const number = getTicketDefaultJob(ticket);
    const job = number ? getJobByNumber(number) : undefined;
    return {
      ticket,
      summary: getJiraTicket(ticket)?.summary ?? null,
      job: job ? { id: job.id, number: job.number, name: job.name } : null,
      todoIds: list.map((todo) => todo.id),
      todos: list.map((todo) => ({ ref: todoRef(todo.id), text: todo.text })),
      hours: time.hours,
      description: text.length > 200 ? `${text.slice(0, 199)}…` : text,
      time: time.lines,
    };
  });
}

/** The tickets of the Jira comments these todos came from (their conversations to read). */
export function commentTickets(todoIds: number[]): string[] {
  const list = [...todosByIds(todoIds).values()];
  const from = todoSources(list, lastGoodRun()?.tickets ?? []);
  return [
    ...new Set(
      list.flatMap((todo) =>
        todo.refs.flatMap((r) => {
          const s = from[r];
          return s?.source === "jira-comment"
            ? [s.comment.ticket || todo.ticket]
            : [];
        }),
      ),
    ),
  ];
}

/**
 * The context of some todos, as links (in this order): the tickets' merge requests, the Jira
 * comments, Teams messages and GitLab comments (each with its conversation) the todos came from,
 * then the todos themselves. Each once.
 */
export function todoContextUrls(ticket: string | null, todoIds: number[]): string[] {
  const list = [...todosByIds(todoIds).values()];
  const from = todoSources(list, lastGoodRun()?.tickets ?? []);
  const keys = [
    ...new Set(
      [ticket, ...list.map((todo) => todo.ticket)]
        .filter((k): k is string => !!k)
        .map((k) => k.toUpperCase()),
    ),
  ];
  const ticketUrl = (key: string) => getJiraTicket(key)?.url ?? null;
  const mrs = gitlabCommentsByTicket(keys, 5, "mr");
  const urls = [
    ...keys.flatMap((k) => (mrs[k] ?? []).map((m) => m.url)),
    ...list.flatMap((todo) =>
      sourcesOf(todo.refs, from).flatMap((s) => {
        if (s.source === "teams") return [s.teams.link];
        if (s.source === "gitlab") return [s.gitlab.url];
        if (s.source === "mail") return [mailLink(s.mail.key)];
        if (s.source === "keep") return s.note.url.startsWith("http") ? [s.note.url] : [];
        if (s.source === "fact" || s.source === "document") return [];
        const url =
          s.comment.url ??
          (ticketUrl(s.comment.ticket)
            ? jiraCommentUrl(ticketUrl(s.comment.ticket)!, s.comment.id)
            : null);
        return url ? [url] : [];
      }),
    ),
    ...list.map((todo) => todoLink(todo.id)),
  ];
  return [...new Set(urls)];
}

/**
 * An entry's context from the todos it books (todoContextUrls), each source once — the item
 * there is for it, when there is one. How many.
 */
export function attachTodoContext(entryId: number, ticket: string | null, todoIds: number[]): number {
  // The time records booked with it: each a piece of evidence — whose todos (related ones too) are context as well.
  const records = getDb().select().from(schema.todoTime).where(eq(schema.todoTime.entryId, entryId)).all();
  const allTodos = [...new Set([...todoIds, ...records.map((r) => r.todoId)])];
  if (!allTodos.length) return 0;
  // The runs booked with it (an agent's through the MCP, a worker's): what was done, how long — last.
  const runs = getDb().select({ id: workRuns.id }).from(workRuns).where(eq(workRuns.entryId, entryId)).all().map((r) => workLink(r.id));
  const urls = [...todoContextUrls(ticket, allTodos), ...records.map((r) => timeLink(r.id)), ...runs];
  const linked = resolveLinks(urls);
  const seen = new Set<string>();
  const ids: number[] = [];
  for (const u of urls) {
    if (!linked[u] || seen.has(u)) continue;
    seen.add(u);
    ids.push(addSource(u, linked[u], { entryId, ticket }).id);
  }
  // In that order (MRs, what they came from, the todos, the time records) — anything else on it after.
  reorderEntryContexts(entryId, ids);
  return seen.size;
}

/**
 * Book a ticket's todos done today as one entry — with the hours and words you settled on —
 * and they (and their workers' runs) are booked. Or (`skip`) only marked not to be booked.
 */
export function bookDoneToday(v: {
  ticket: string;
  todoIds: number[];
  hours: number;
  description: string;
  skip?: boolean;
  /** false: the context is attached by the caller (after answering). */
  context?: boolean;
}): { entryId: number | null; hours: number; todoIds: number[] } {
  const ids = [...new Set(v.todoIds.map(Number).filter(Number.isInteger))];
  const open = getDb()
    .select({ id: todos.id })
    .from(todos)
    .where(
      and(inArray(todos.id, ids.length ? ids : [-1]), isNull(todos.entryId)),
    )
    .all()
    .map((r) => r.id);
  if (!open.length)
    throw new ValidationError(t("Nothing left to book — booked already?"));
  // The time these todos (and the ones related to them) have reported: booked with the entry.
  const group = getDb().select({ id: todos.id, text: todos.text }).from(todos).where(inArray(todos.id, open)).all();
  const suggested = suggestedEvidence();
  const time = groupTime(
    group,
    getDb().select().from(workRuns).where(and(inArray(workRuns.todoId, open), eq(workRuns.status, "done"), isNull(workRuns.entryId))).all().filter((r) => !suggested.runIds.has(r.id)),
    suggested,
  );
  if (v.skip) {
    markTimeBooked(time.timeIds, -1);
    getDb()
      .update(todos)
      .set({ entryId: -1 })
      .where(inArray(todos.id, open))
      .run();
    return { entryId: null, hours: 0, todoIds: open };
  }
  if (!(v.hours > 0) || v.hours > 24)
    throw new ValidationError(t("Hours: more than 0, at most 24."));
  const jobNumber = getTicketDefaultJob(v.ticket);
  if (!jobNumber)
    throw new ValidationError(
      t("{ticket} has no job — give it (or its board) one on the Jira tab.", {
        ticket: v.ticket,
      }),
    );
  const entry = createEntry(
    {
      jobNumber,
      date: isoDate(new Date()),
      hours: round2(v.hours),
      description: v.description.trim() || v.ticket,
      ticket: v.ticket,
    },
    "web",
  );
  getDb()
    .update(todos)
    .set({ entryId: entry.id })
    .where(inArray(todos.id, open))
    .run();
  markTimeBooked(time.timeIds, entry.id);
  if (v.context !== false) attachTodoContext(entry.id, v.ticket, open);
  getDb()
    .update(workRuns)
    .set({ entryId: entry.id })
    .where(and(inArray(workRuns.todoId, open), isNull(workRuns.entryId)))
    .run();
  return { entryId: entry.id, hours: round2(v.hours), todoIds: open };
}
