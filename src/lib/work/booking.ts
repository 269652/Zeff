import { mailLink } from "@/lib/mail/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { jiraCommentUrl, sourcesOf, todoRef } from "@/lib/boards/shared";
import { todoSources } from "@/lib/boards/sources";
import { lastGoodRun, listTodos, todosByIds } from "@/lib/boards/store";
import { resolveLinks } from "@/lib/context-links";
import { addSource, reorderEntryContexts } from "@/lib/contexts";
import { todoLink, workLink } from "@/lib/entities-shared";
import { createEntry } from "@/lib/entries";
import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { round2 } from "@/lib/format";
import { gitlabCommentsByTicket } from "@/lib/gitlab/store";
import { getJiraTicket, getTicketDefaultJob } from "@/lib/jira/store";
import { getJobByNumber } from "@/lib/jobs";
import { isoDate } from "@/lib/week";
import { suggestedEvidence } from "./suggestions";

const { todos, workRuns } = schema;

/** Booked time: quarter hours, rounded up — at least one. */
const quarters = (ms: number) => Math.max(0.25, Math.ceil(ms / 900000) * 0.25);

/** A ticket's todos done today, as one entry to book: on its job, their time, their lines. */
export type DoneToday = {
  ticket: string;
  summary: string | null;
  job: { id: number; number: string; name: string } | null;
  todoIds: number[];
  todos: { ref: string; text: string }[];
  /** The workers' summed time on them (quarter hours, rounded up) plus a quarter per todo done by hand. */
  hours: number;
  description: string;
};

/**
 * The todos done today and not booked yet, by ticket — each an entry to book: the time the
 * workers took on them (and a quarter hour for each done by hand), their lines (the workers'
 * entry lines, else the todos' texts) as the description, the ticket's job.
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
    const ms = theirs.reduce((a, r) => a + (r.durationMs ?? 0), 0);
    const byHand = list.filter(
      (todo) => !theirs.some((r) => r.todoId === todo.id),
    ).length;
    const lines = [
      ...new Set([
        ...theirs
          .map((r) => r.entryLine?.trim())
          .filter((l): l is string => !!l),
        ...list
          .filter((todo) => !theirs.some((r) => r.todoId === todo.id))
          .map((todo) => todo.text.trim()),
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
      hours: round2((ms ? quarters(ms) : 0) + byHand * 0.25),
      description: text.length > 200 ? `${text.slice(0, 199)}…` : text,
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
        if (s.source === "fact") return [];
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
  if (!todoIds.length) return 0;
  // The runs booked with it (an agent's through the MCP, a worker's): what was done, how long — last.
  const runs = getDb().select({ id: workRuns.id }).from(workRuns).where(eq(workRuns.entryId, entryId)).all().map((r) => workLink(r.id));
  const urls = [...todoContextUrls(ticket, todoIds), ...runs];
  const linked = resolveLinks(urls);
  const seen = new Set<string>();
  const ids: number[] = [];
  for (const u of urls) {
    if (!linked[u] || seen.has(u)) continue;
    seen.add(u);
    ids.push(addSource(u, linked[u], { entryId, ticket }).id);
  }
  // In that order (MRs, what they came from, the todos) — anything else on it after.
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
  if (v.skip) {
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
  if (v.context !== false) attachTodoContext(entry.id, v.ticket, open);
  getDb()
    .update(workRuns)
    .set({ entryId: entry.id })
    .where(and(inArray(workRuns.todoId, open), isNull(workRuns.entryId)))
    .run();
  return { entryId: entry.id, hours: round2(v.hours), todoIds: open };
}
