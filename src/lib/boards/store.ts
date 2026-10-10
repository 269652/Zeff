import { parseTodoKnowledge } from "@/plugins/knowledge/shared";
import { duplicateTodo } from "./similar";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { emitChange } from "@/lib/events";
import type { BoardRun, BoardSettings, Todo } from "@/db/schema";
import { NotFoundError } from "@/lib/errors";
import { resolveRefs, unresolveRefs } from "@/lib/resolved";
import { cleanOps, cleanPlan, DELIVERY_OP_TYPES, dueDay, isTodoKind, parseTodoRef, todoRef, type BoardResult, type BoardRunView, type BoardTicket, type TodoOp, type TodoPath, type TodoStatus, type TodoStep, type TodoView } from "./shared";

const { boardSettings, boardRuns, todos } = schema;

export function getBoardSettings(): BoardSettings {
  const db = getDb();
  const row = db.select().from(boardSettings).limit(1).get();
  if (row) return row;
  // Several processes may get here at once on a fresh database (next build's workers): one insert wins.
  db.insert(boardSettings).values({ id: 1 }).onConflictDoNothing().run();
  return db.select().from(boardSettings).limit(1).get()!;
}

export function updateBoardSettings(patch: Partial<Omit<BoardSettings, "id">>): BoardSettings {
  getBoardSettings(); // ensure the row exists
  return getDb().update(boardSettings).set(patch).returning().get();
}

const parse = <T>(json: string | null, fallback: T): T => {
  try {
    return json ? (JSON.parse(json) as T) : fallback;
  } catch {
    return fallback;
  }
};

const toRun = (r: BoardRun): BoardRunView => ({
  id: r.id,
  status: r.status === "ok" || r.status === "error" ? r.status : "running",
  jql: r.jql,
  model: r.model,
  tickets: parse<BoardTicket[]>(r.tickets, []),
  result: parse<BoardResult | null>(r.result, null),
  error: r.error,
  costUsd: r.costUsd,
  durationMs: r.durationMs,
  startedAt: r.startedAt,
  finishedAt: r.finishedAt,
});

/** A run begins (its tickets and answer come when it finishes). */
export function startRun(jql: string, model: string | null): number {
  return getDb().insert(boardRuns).values({ jql, model, status: "running" }).returning().get().id;
}

export function finishRun(
  id: number,
  patch: { status: "ok" | "error"; tickets?: BoardTicket[]; result?: BoardResult; error?: string; model?: string | null; costUsd?: number | null; durationMs?: number | null },
): void {
  getDb()
    .update(boardRuns)
    .set({
      status: patch.status,
      ...(patch.tickets ? { tickets: JSON.stringify(patch.tickets) } : {}),
      ...(patch.result ? { result: JSON.stringify(patch.result) } : {}),
      ...(patch.error !== undefined ? { error: patch.error.slice(0, 2000) } : {}),
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.costUsd !== undefined ? { costUsd: patch.costUsd } : {}),
      ...(patch.durationMs !== undefined ? { durationMs: patch.durationMs } : {}),
      finishedAt: sql`(CURRENT_TIMESTAMP)`,
    })
    .where(eq(boardRuns.id, id))
    .run();
}

/** A run by its number. */
export function getBoardRun(id: number): BoardRunView | null {
  const r = getDb().select().from(boardRuns).where(eq(boardRuns.id, id)).get();
  return r ? toRun(r) : null;
}

/** The newest run, whatever became of it. */
export function latestRun(): BoardRunView | null {
  const r = getDb().select().from(boardRuns).orderBy(desc(boardRuns.id)).limit(1).get();
  return r ? toRun(r) : null;
}

/** The newest run that worked (before the given one). */
export function lastGoodRun(before?: number): BoardRunView | null {
  const r = getDb()
    .select()
    .from(boardRuns)
    .where(before ? and(eq(boardRuns.status, "ok"), lt(boardRuns.id, before)) : eq(boardRuns.status, "ok"))
    .orderBy(desc(boardRuns.id))
    .limit(1)
    .get();
  return r ? toRun(r) : null;
}

/** Runs left "running" by a server that stopped mid-run: failed. How many. */
export function failInterruptedRuns(): number {
  const error = "Stopped — the server restarted during the run.";
  const runs = getDb().update(boardRuns).set({ status: "error", error, finishedAt: sql`(CURRENT_TIMESTAMP)` }).where(eq(boardRuns.status, "running")).returning().all().length;
  // A day's recap too: left "running", that day would never be recapped again.
  const recaps = getDb().update(schema.dayRecaps).set({ status: "error", error, finishedAt: sql`(CURRENT_TIMESTAMP)` }).where(eq(schema.dayRecaps.status, "running")).returning().all().length;
  return runs + recaps;
}

/** SQLite's CURRENT_TIMESTAMP ("2026-10-06 09:22:02", UTC) as ISO, like the ones written here. */
const iso = (t: string) => (/^\d{4}-\d{2}-\d{2} /.test(t) ? `${t.replace(" ", "T")}Z` : t);

/**
 * A todo's operations: its own — or, for a Jira comment or reply with a drafted text and none
 * of its own, posting that text (no AI needed).
 */
function opsOf(r: Todo): TodoView["ops"] {
  const own = cleanOps(parse<unknown[]>(r.ops, []), r.ticket);
  if (own.length || r.status !== "open" || r.channel !== "jira" || !r.draft?.trim() || !["comment", "reply"].includes(r.kind)) return own;
  const ticket = r.target && /^[A-Z][A-Z0-9]+-\d+$/i.test(r.target) ? r.target.toUpperCase() : r.ticket;
  return [{ type: "jira-comment", ticket, body: r.draft.trim() }];
}

/**
 * What a todo is related to, by the relation runs (its mail_refs column): the mails (Mail-Zuordnung,
 * "mail:…") and the notes (Notiz-Zuordnung, Keep's extension, "keep:…").
 */
const relatedRefsOf = (r: Todo) => parse<string[]>(r.mailRefs, []).filter((k) => typeof k === "string" && (k.startsWith("mail:") || k.startsWith("keep:")));
/** The mails related to a todo (by the mail relation run). */
const mailRefsOf = (r: Todo) => relatedRefsOf(r).filter((k) => k.startsWith("mail:"));

const toTodo = (r: Todo): TodoView => ({
  id: r.id,
  ref: todoRef(r.id),
  due: r.due ?? null,
  knowledge: parseTodoKnowledge(r.knowledge),
  ticket: r.ticket,
  text: r.text,
  kind: isTodoKind(r.kind) ? r.kind : "other",
  owner: r.owner === "other" ? "other" : "me",
  status: r.status === "done" || r.status === "dismissed" ? r.status : "open",
  source: r.source,
  // What it came from (the Ticket-Lage's pick), then the mails and notes related to it.
  refs: [...new Set([...parse<string[]>(r.refs, []), ...relatedRefsOf(r)])],
  mailRefs: mailRefsOf(r),
  autoOpsWhy: r.autoOpsWhy ?? null,
  note: r.note,
  draft: r.draft,
  channel: r.channel === "jira" || r.channel === "teams" || r.channel === "gitlab" ? r.channel : null,
  target: r.target,
  parentId: r.parentId,
  workRunId: r.workRunId,
  ops: opsOf(r),
  planned: cleanPlan(parse<unknown[]>(r.planned, []), r.ticket),
  path: r.path,
  needsInput: r.needsInput ?? null,
  userNotes: parse<TodoView["userNotes"]>(r.userNotes, []).filter((n) => n && typeof n.text === "string"),
  deferredAt: r.deferredAt ?? null,
  flaggedAt: r.flaggedAt ?? null,
  alsoTickets: parse<string[]>(r.alsoTickets, []).filter((k) => typeof k === "string"),
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
  doneAt: r.doneAt && iso(r.doneAt),
});

/** Todos, oldest first: of a ticket, in a state ("all": any). */
/**
 * A relation run's pick: per todo, what it's about — its refs of one kind ("mail:" / "keep:")
 * replaced, the other kind's kept. Todos not in `picks` keep theirs.
 */
function setRelatedRefs(prefix: "mail:" | "keep:", picks: Map<number, string[]>): number {
  if (!picks.size) return 0;
  let changed = 0;
  getDb().transaction((tx) => {
    for (const [id, refs] of picks) {
      const row = tx.select({ mailRefs: todos.mailRefs }).from(todos).where(eq(todos.id, id)).get();
      if (!row) continue;
      const others = parse<string[]>(row.mailRefs, []).filter((k) => typeof k === "string" && !k.startsWith(prefix));
      const json = JSON.stringify([...others, ...[...new Set(refs.filter((r) => r.startsWith(prefix)))].slice(0, 10)]);
      const r = tx.update(todos).set({ mailRefs: json }).where(and(eq(todos.id, id), sql`${todos.mailRefs} <> ${json}`)).run();
      changed += r.changes;
    }
  });
  if (changed) emitChange("todos");
  return changed;
}

/** The mail relation run's pick: per todo, the mails it's about (["mail:<key>"]); its notes stay. */
export const setTodoMailRefs = (picks: Map<number, string[]>) => setRelatedRefs("mail:", picks);

/** The Notiz-Zuordnung's pick (Keep's extension): per todo, the notes it's about (["keep:…"]); its mails stay. */
export const setTodoNoteRefs = (picks: Map<number, string[]>) => setRelatedRefs("keep:", picks);

/** A todo on this ticket: its main ticket, or one it's linked to. */
const onTicket = (key: string) => or(eq(todos.ticket, key), sql`${todos.alsoTickets} like ${`%"${key}"%`}`);

/** The older of two tickets (the original): the lower number of the same project; else the first. */
const olderTicket = (a: string, b: string) => {
  const [pa, na] = a.split("-");
  const [pb, nb] = b.split("-");
  return pa === pb && Number(nb) < Number(na) ? b : a;
};

/**
 * A todo about another ticket too (the same thing on two tickets): linked to it — the original
 * (the older ticket) its main ticket, the other one linked. It shows on both.
 */
export function linkTodoTicket(id: number, ticket: string, tx: Pick<ReturnType<typeof getDb>, "update"> = getDb()): void {
  const t = getTodo(id);
  const key = ticket.trim().toUpperCase();
  if (!t || t.ticket === key || t.alsoTickets.includes(key)) return;
  const main = olderTicket(t.ticket, key);
  const also = [...new Set([...t.alsoTickets, t.ticket, key])].filter((k) => k !== main);
  tx.update(todos).set({ ticket: main, alsoTickets: JSON.stringify(also), updatedAt: new Date().toISOString() }).where(eq(todos.id, id)).run();
  emitChange("todos");
}

export function listTodos(opts: { ticket?: string; status?: TodoStatus | "all"; tickets?: string[] } = {}): TodoView[] {
  const status = opts.status ?? "open";
  const where = and(
    status === "all" ? undefined : eq(todos.status, status),
    opts.ticket ? onTicket(opts.ticket.trim().toUpperCase()) : undefined,
    opts.tickets ? (opts.tickets.length ? or(...opts.tickets.map((k) => onTicket(k.trim().toUpperCase()))) : eq(todos.ticket, "")) : undefined,
  );
  return getDb().select().from(todos).where(where).orderBy(todos.id).all().map(toTodo);
}

/** These tickets' todos as the Todos page shows them: the open ones, and those closed in the last `days`. */
export function boardTodos(tickets: string[], days = 7): TodoView[] {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  return listTodos({ status: "all", tickets }).filter((t) => t.status === "open" || (t.doneAt ?? "") >= since);
}

/** Done and dismissed todos, the latest first — all of them (up to `limit`). */
export function doneTodos(limit = 300): TodoView[] {
  return getDb()
    .select()
    .from(todos)
    .where(inArray(todos.status, ["done", "dismissed"]))
    .orderBy(desc(todos.doneAt), desc(todos.id))
    .limit(limit)
    .all()
    .map(toTodo);
}

/**
 * The todos you dropped in the last `days` (dismissed by you, not by a run or another path taken):
 * the reviews don't propose one like them again — a new message in the same conversation isn't
 * reason enough.
 */
export function droppedByYou(days = 60): TodoView[] {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  return getDb()
    .select()
    .from(todos)
    .where(
      and(
        eq(todos.status, "dismissed"),
        sql`${todos.doneAt} >= ${since}`,
        sql`(select e.actor from todo_events e where e.todo_id = ${todos.id} and e.event = 'dismissed' order by e.id desc limit 1) = 'you'`,
      ),
    )
    .all()
    .map(toTodo);
}

/** How many todos are done or dismissed (up to `limit`, the newest), and their tickets — without reading them whole. */
export function doneTodoTickets(limit = 300): { count: number; tickets: string[] } {
  const rows = getDb()
    .select({ ticket: todos.ticket })
    .from(todos)
    .where(inArray(todos.status, ["done", "dismissed"]))
    .orderBy(desc(todos.doneAt), desc(todos.id))
    .limit(limit)
    .all();
  return { count: rows.length, tickets: [...new Set(rows.map((r) => r.ticket).filter(Boolean))] };
}

/** The todos with these ids, by id. */
export function todosByIds(ids: number[]): Map<number, TodoView> {
  const wanted = [...new Set(ids)].slice(0, 200);
  if (!wanted.length) return new Map();
  return new Map(getDb().select().from(todos).where(inArray(todos.id, wanted)).all().map((r) => [r.id, toTodo(r)]));
}

/**
 * Todos for the context search: matching words (text, ticket, note) or a reference ("T-12") —
 * done ones first (newest first), then open ones. Done work is what backs an entry.
 */
export function searchTodos(q: string, limit = 8): TodoView[] {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const ref = parseTodoRef(q);
  const all = getDb().select().from(todos).where(inArray(todos.status, ["done", "open"])).orderBy(desc(todos.id)).limit(500).all().map(toTodo);
  const hits = ref !== null && /^\s*t/i.test(q)
    ? all.filter((t) => t.id === ref)
    : all.filter((t) => words.every((w) => `${t.ref} ${t.ticket} ${t.text} ${t.note ?? ""}`.toLowerCase().includes(w)));
  return hits
    .sort((a, b) => (a.status === b.status ? (b.doneAt ?? b.createdAt).localeCompare(a.doneAt ?? a.createdAt) : a.status === "done" ? -1 : 1))
    .slice(0, limit);
}

export function getTodo(id: number): TodoView | undefined {
  const r = getDb().select().from(todos).where(eq(todos.id, id)).get();
  return r ? toTodo(r) : undefined;
}

/**
 * Done, dismissed, or open again — with why, when given. Settled (done or dismissed), the Jira
 * comments, Teams messages and GitLab comments it came from are marked done too: no new todos
 * from them; opened again (an undo), they're open again.
 */
export function setTodoStatus(id: number, status: TodoStatus, note?: string | null): TodoView {
  emitChange("todos");
  const db = getDb();
  const before = getTodo(id);
  if (!before) throw new NotFoundError(`Todo ${todoRef(id)} not found.`);
  if (status !== "open") resolveRefs(before.refs, before.ticket);
  else if (before.status !== "open") unresolveRefs(before.refs, before.ticket); // taken back: they're open again
  const now = new Date().toISOString();
  db.update(todos)
    .set({
      status,
      updatedAt: now,
      doneAt: status === "open" ? null : now,
      ...(note !== undefined ? { note: note?.trim().slice(0, 500) || null } : {}),
    })
    .where(eq(todos.id, id))
    .run();
  if (status === "done" && before.status !== "done") afterDone(id);
  return getTodo(id)!;
}

/**
 * A todo done: on an alternative path, the other paths' open todos are dropped (that way was
 * taken); its planned steps come next — each path's first step as a todo, carrying the rest.
 */
function afterDone(id: number): void {
  const t = getTodo(id);
  if (!t) return;
  if (t.path && t.parentId) {
    const now = new Date().toISOString();
    getDb()
      .update(todos)
      .set({ status: "dismissed", note: `Anderer Weg gewählt (${t.path}, ${t.ref}).`, doneAt: now, updatedAt: now })
      .where(and(eq(todos.parentId, t.parentId), eq(todos.status, "open"), sql`${todos.path} is not null and ${todos.path} <> ${t.path}`))
      .run();
  }
  if (!t.planned.length) return;
  getDb().update(todos).set({ planned: "[]" }).where(eq(todos.id, id)).run();
  for (const p of t.planned) {
    const [first, ...rest] = p.steps;
    if (!first) continue;
    addFollowUp({
      ticket: t.ticket,
      text: first.text,
      kind: first.kind,
      owner: first.owner,
      ops: first.ops,
      parentId: t.id,
      workRunId: null,
      source: `Geplant nach ${t.ref}`,
      path: t.planned.length > 1 ? p.path : null,
      planned: rest.length ? [{ path: null, steps: rest }] : [],
    });
  }
}

/**
 * A todo's plan handed on to the todo that carries its work further (a delivery a run left):
 * what that one does itself is dropped from the front of each path (`skip`: merge, review), the
 * paths that are then the same become one. The plan's then the other's.
 */
export function handOverPlan(fromId: number, toId: number, skip: TodoView["kind"][] = []): void {
  const from = getTodo(fromId);
  if (!from?.planned.length) return;
  const plan = planAfter(from, skip);
  getDb().update(todos).set({ planned: "[]" }).where(eq(todos.id, fromId)).run();
  if (plan.length) getDb().update(todos).set({ planned: JSON.stringify(plan) }).where(eq(todos.id, toId)).run();
  emitChange("todos");
}

/** What's planned after a todo, minus the steps at the front of each path of kinds the next todo does itself; paths that are then alike, once. */
function planAfter(from: TodoView, skip: TodoView["kind"][]): TodoPath[] {
  const seen = new Set<string>();
  const rest = from.planned.flatMap((p) => {
    let i = 0;
    while (i < p.steps.length && skip.includes(p.steps[i].kind)) i++;
    const steps = p.steps.slice(i);
    const key = JSON.stringify(steps.map((x) => [x.text, x.kind]));
    if (!steps.length || seen.has(key)) return [];
    seen.add(key);
    return [{ path: p.path, steps }];
  });
  return rest.length === 1 ? [{ ...rest[0], path: null }] : rest;
}

/**
 * An implementation's delivery — after you've tested it: a todo to test and verify it by hand now
 * (no buttons: that's yours); its delivery (push → merge request, or merge into main) its planned
 * next step, which appears with its buttons once the test todo is ticked off. What was planned
 * after the implementation goes on after the delivery (minus the testing, review and merge it covers).
 */
export function addTestedDelivery(v: { from: TodoView; workRunId: number | null; source: string; branch: string; delivery: { text: string; ops: TodoOp[] } }): TodoView {
  const step: TodoStep = { text: v.delivery.text, kind: "merge", owner: "me", ops: v.delivery.ops };
  // One way on: the delivery decides MR or direct merge, so plans that differed in that are alike now — the first stays.
  const rest = planAfter(v.from, ["test", "review", "merge"])[0];
  const planned: TodoPath[] = [{ path: null, steps: [step, ...(rest?.steps ?? [])].slice(0, 6) }];
  getDb().update(todos).set({ planned: "[]" }).where(eq(todos.id, v.from.id)).run();
  return addFollowUp({
    ticket: v.from.ticket,
    text: `Manuell testen und verifizieren (${v.branch}): ${v.from.text}`.slice(0, 500),
    kind: "test",
    parentId: v.from.id,
    workRunId: v.workRunId,
    source: `${v.source} — erst getestet, dann ausgeliefert`,
    planned,
  });
}

/** Whether an open todo delivers this branch — now (its operations) or once it's done (its planned steps'). */
export function deliversBranch(t: TodoView, branch: string): boolean {
  const names = (ops: TodoOp[]) => ops.some((o) => ("branch" in o && o.branch.replace(/^origin\//, "") === branch) || ("source" in o && o.source === branch));
  return names(t.ops) || t.planned.some((p) => p.steps.some((s) => names(s.ops)));
}

/**
 * A todo a work run left behind (a follow-up): on its ticket, mine, with its message drafted
 * and where it goes — and what it came from (the message it answers), so that's done with it.
 */
export function addFollowUp(v: {
  ticket: string;
  text: string;
  kind: string;
  draft?: string | null;
  channel?: string | null;
  target?: string | null;
  parentId: number;
  workRunId: number | null;
  source: string;
  ops?: unknown[];
  /** other: waiting for someone else first (a merge request's approval). */
  owner?: "me" | "other";
  /** What comes after it (a planned step's rest), and the alternative path it's on. */
  planned?: TodoView["planned"];
  path?: string | null;
}): TodoView {
  emitChange("todos");
  const now = new Date().toISOString();
  const target = v.target?.trim() || null;
  const refs = target && /^(jira-comment|teams|gitlab):./.test(target) ? [target] : [];
  const row = getDb()
    .insert(todos)
    .values({
      ticket: v.ticket.trim().toUpperCase(),
      text: v.text.trim().slice(0, 500),
      kind: isTodoKind(v.kind) ? v.kind : "other",
      owner: v.owner === "other" ? "other" : "me",
      status: "open",
      source: v.source.slice(0, 200),
      refs: JSON.stringify(refs),
      draft: v.draft?.trim().slice(0, 8000) || null,
      channel: v.channel === "jira" || v.channel === "teams" || v.channel === "gitlab" ? v.channel : null,
      target,
      parentId: v.parentId,
      workRunId: v.workRunId,
      ops: JSON.stringify(cleanOps(v.ops, v.ticket.trim().toUpperCase())),
      planned: JSON.stringify(v.planned ?? []),
      path: v.path ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return toTodo(row);
}


/**
 * A todo the Mail-Durchsicht found in a mail (a training to do, a form to fill in …): on a ticket
 * when it's about one, else on none (ticket "") — with the mails it came from.
 */
export function addMailTodo(v: { ticket: string; text: string; kind: string; owner?: "me" | "other"; refs: string[]; runId: number | null; due?: string | null }): TodoView {
  emitChange("todos");
  const now = new Date().toISOString();
  const row = getDb()
    .insert(todos)
    .values({
      ticket: v.ticket.trim().toUpperCase(),
      text: v.text.trim().slice(0, 500),
      kind: isTodoKind(v.kind) ? v.kind : "other",
      owner: v.owner === "other" ? "other" : "me",
      status: "open",
      source: "Mail-Durchsicht",
      refs: JSON.stringify(v.refs.filter((r) => r.startsWith("mail:") || r.startsWith("fact:")).slice(0, 15)),
      runId: v.runId,
      due: dueDay(v.due),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return toTodo(row);
}

/** A todo from the Notiz-Durchsicht (Keep's extension): what a note asks of you, the notes as its source. */
export function addNoteTodo(v: { ticket: string; text: string; kind: string; owner?: "me" | "other"; refs: string[]; runId: number | null; due?: string | null }): TodoView {
  emitChange("todos");
  const now = new Date().toISOString();
  const row = getDb()
    .insert(todos)
    .values({
      ticket: v.ticket.trim().toUpperCase(),
      text: v.text.trim().slice(0, 500),
      kind: isTodoKind(v.kind) ? v.kind : "other",
      owner: v.owner === "other" ? "other" : "me",
      status: "open",
      source: "Notiz-Durchsicht",
      refs: JSON.stringify(v.refs.filter((r) => r.startsWith("keep:")).slice(0, 15)),
      runId: v.runId,
      due: dueDay(v.due),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return toTodo(row);
}

/** A todo you add yourself (a Kanban card's checklist): yours, on that ticket. */
/**
 * A todo from a calendar appointment (its calendar set to "Todos"): the appointment's title, due on
 * its day; `ref` ("event:<id>@<day>") says which — none twice for the same.
 */
export function addCalendarTodo(v: { text: string; due: string; ref: string; source: string }): TodoView | null {
  if (getDb().select({ id: todos.id }).from(todos).where(sql`${todos.refs} like ${`%"${v.ref}"%`}`).get()) return null;
  emitChange("todos");
  const now = new Date().toISOString();
  const row = getDb()
    .insert(todos)
    .values({ ticket: "", text: v.text.trim().slice(0, 500), kind: "other", owner: "me", status: "open", source: v.source.slice(0, 200), refs: JSON.stringify([v.ref]), runId: null, due: dueDay(v.due), createdAt: now, updatedAt: now })
    .returning()
    .get();
  return toTodo(row);
}

export function addManualTodo(v: { ticket: string; text: string }): TodoView {
  emitChange("todos");
  const now = new Date().toISOString();
  const row = getDb()
    .insert(todos)
    .values({ ticket: v.ticket.trim().toUpperCase(), text: v.text.trim().slice(0, 500), kind: "other", owner: "me", status: "open", source: "Von dir", refs: "[]", runId: null, createdAt: now, updatedAt: now })
    .returning()
    .get();
  return toTodo(row);
}

/** A todo for a work session (Work: a new session — on a ticket, or none): your instruction's first line. */
export function addSessionTodo(v: { ticket: string; text: string }): TodoView {
  emitChange("todos");
  const now = new Date().toISOString();
  const row = getDb()
    .insert(todos)
    .values({ ticket: v.ticket.trim().toUpperCase(), text: v.text.trim().slice(0, 500), kind: "other", owner: "me", status: "open", source: "Work-Session", refs: "[]", runId: null, createdAt: now, updatedAt: now })
    .returning()
    .get();
  return toTodo(row);
}

/** A todo's operations, replaced (e.g. merging straight into main instead of a merge request). */
export function setTodoOps(id: number, ops: TodoView["ops"], text?: string): TodoView {
  emitChange("todos");
  getDb()
    .update(todos)
    .set({ ops: JSON.stringify(ops), autoOpsWhy: null, ...(text ? { text: text.slice(0, 500) } : {}), updatedAt: new Date().toISOString() })
    .where(eq(todos.id, id))
    .run();
  return getTodo(id)!;
}

/** Your note on a todo, added (context for whoever works on it) — or one taken away (by its time). */
export function addTodoUserNote(id: number, text: string): TodoView {
  const t = getTodo(id);
  if (!t) throw new NotFoundError(`Todo ${todoRef(id)} not found.`);
  const note = text.trim().slice(0, 4000);
  if (!note) return t;
  const notes = [...t.userNotes, { at: new Date().toISOString(), text: note }];
  getDb().update(todos).set({ userNotes: JSON.stringify(notes), updatedAt: new Date().toISOString() }).where(eq(todos.id, id)).run();
  emitChange("todos");
  return getTodo(id)!;
}

/**
 * What a new message adds to an open todo (the Mail-Durchsicht found it: an answer, a date, a
 * piece it needs): the messages among its sources (its context), and a note saying what's new.
 */
export function addTodoContext(id: number, refs: string[], note: string, by: string): TodoView | undefined {
  const t = getTodo(id);
  if (!t) return undefined;
  const row = getDb().select({ refs: todos.refs, userNotes: todos.userNotes }).from(todos).where(eq(todos.id, id)).get();
  const had = JSON.parse(row?.refs ?? "[]") as string[];
  const merged = [...new Set([...had, ...refs])].slice(-30);
  const notes = JSON.parse(row?.userNotes ?? "[]") as { at: string; text: string; by?: string }[];
  const text = note.trim().slice(0, 1000);
  getDb()
    .update(todos)
    .set({ refs: JSON.stringify(merged), ...(text ? { userNotes: JSON.stringify([...notes, { at: new Date().toISOString(), text, by }]) } : {}), updatedAt: new Date().toISOString() })
    .where(eq(todos.id, id))
    .run();
  emitChange("todos");
  return getTodo(id);
}

/** A todo flagged important (to the top, urgent) — or the flag taken off. Flagged, it's no longer put down. */
/** A todo's deadline (YYYY-MM-DD), set or taken away by hand. */
export function setTodoDue(id: number, due: string | null): void {
  getDb().update(todos).set({ due: dueDay(due), updatedAt: new Date().toISOString() }).where(eq(todos.id, id)).run();
  emitChange("todos");
}

export function setTodoFlagged(id: number, flagged: boolean): void {
  getDb()
    .update(todos)
    .set(flagged ? { flaggedAt: new Date().toISOString(), deferredAt: null } : { flaggedAt: null })
    .where(eq(todos.id, id))
    .run();
  emitChange("todos");
}

/** A todo put to the bottom for now (or taken back up). */
export function setTodoDeferred(id: number, deferred: boolean): void {
  getDb().update(todos).set({ deferredAt: deferred ? new Date().toISOString() : null }).where(eq(todos.id, id)).run();
  emitChange("todos");
}

/** A run's report on a todo it leaves open — what it did, and where to see it (the pushed commit). */
export function addTodoAiNote(id: number, v: { text: string; by: string; url?: string; urlLabel?: string }): void {
  const t = getTodo(id);
  if (!t || !v.text.trim()) return;
  const note = { at: new Date().toISOString(), text: v.text.trim().slice(0, 4000), by: v.by, ...(v.url ? { url: v.url, urlLabel: v.urlLabel ?? v.url } : {}) };
  getDb().update(todos).set({ userNotes: JSON.stringify([...t.userNotes, note]), updatedAt: new Date().toISOString() }).where(eq(todos.id, id)).run();
  emitChange("todos");
}

/** Your instruction to a worker (✨), kept on the todo as your words — with the run doing it. */
export function addTodoInstruction(id: number, text: string, runId: number): void {
  const t = getTodo(id);
  const note = text.trim().slice(0, 4000);
  if (!t || !note) return;
  const n: TodoView["userNotes"][number] = { at: new Date().toISOString(), text: note, kind: "instruction", run: runId };
  getDb().update(todos).set({ userNotes: JSON.stringify([...t.userNotes, n]), updatedAt: new Date().toISOString() }).where(eq(todos.id, id)).run();
  emitChange("todos");
}

export function removeTodoUserNote(id: number, at: string): TodoView {
  const t = getTodo(id);
  if (!t) throw new NotFoundError(`Todo ${todoRef(id)} not found.`);
  getDb().update(todos).set({ userNotes: JSON.stringify(t.userNotes.filter((n) => n.at !== at)) }).where(eq(todos.id, id)).run();
  emitChange("todos");
  return getTodo(id)!;
}

/** An agent working on it waits for your answer — its question (null: it goes on). */
export function setTodoNeedsInput(id: number, question: string | null): void {
  getDb().update(todos).set({ needsInput: question?.trim().slice(0, 2000) || null }).where(eq(todos.id, id)).run();
  emitChange("todos");
}

/**
 * Merge todos waiting for their merge request's approval: yours once GitLab (as synced) says it's
 * approved. How many.
 */
export function promoteApprovedMerges(approved: Set<string>): number {
  let n = 0;
  for (const t of listTodos({ status: "open" })) {
    if (t.owner !== "other") continue;
    const op = t.ops.find((o) => o.type === "gitlab-merge");
    if (op && op.type === "gitlab-merge" && approved.has(`mr:${op.project}!${op.iid}`)) {
      getDb().update(todos).set({ owner: "me", updatedAt: new Date().toISOString() }).where(eq(todos.id, t.id)).run();
      n++;
    }
  }
  return n;
}

/** A todo's drafted message (and where it goes), as a worker wrote it or you changed it. */
export function setTodoDraft(id: number, v: { draft: string | null; channel?: string | null; target?: string | null; workRunId?: number }): TodoView {
  emitChange("todos");
  if (!getTodo(id)) throw new NotFoundError(`Todo ${todoRef(id)} not found.`);
  getDb()
    .update(todos)
    .set({
      draft: v.draft?.trim().slice(0, 8000) || null,
      ...(v.channel !== undefined ? { channel: v.channel === "jira" || v.channel === "teams" || v.channel === "gitlab" ? v.channel : null } : {}),
      ...(v.target !== undefined ? { target: v.target?.trim() || null } : {}),
      ...(v.workRunId !== undefined ? { workRunId: v.workRunId } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(todos.id, id))
    .run();
  return getTodo(id)!;
}

/**
 * Take in a run's todos: one it kept (by its number, still open) is updated, a new one added
 * (numbered), one it found done or overtaken closed with its reason. Open ones it didn't
 * mention stay as they are. How many of each.
 */
export function reconcileTodos(result: BoardResult, runId: number): { added: number; kept: number; closed: number } {
  emitChange("todos");
  const out = { added: 0, kept: 0, closed: 0 };
  const now = new Date().toISOString();
  const resolved: number[] = [];
  // (The Lage's own operations aren't taken: a todo's actions are the auto-actions step's.)
  // What's open on any ticket: a new todo repeating one of them isn't made again.
  const openAll = listTodos({ status: "open" });
  getDb().transaction((tx) => {
    for (const t of result.tickets) {
      const ticket = t.key.trim().toUpperCase();
      const open = new Set(
        tx
          .select({ id: todos.id })
          .from(todos)
          .where(and(onTicket(ticket), eq(todos.status, "open")))
          .all()
          .map((r) => r.id),
      );
      for (const r of t.resolved ?? []) {
        if (!open.has(r.id)) continue;
        // Done: its plan goes on. Superseded (or not said): dropped, nothing follows from it.
        const done = r.done === true;
        tx.update(todos)
          .set({ status: done ? "done" : "dismissed", note: `${done ? "Laut Lauf erledigt" : "Laut Lauf überholt"}: ${r.why}`.slice(0, 500), doneAt: now, updatedAt: now, runId })
          .where(eq(todos.id, r.id))
          .run();
        open.delete(r.id);
        if (done) resolved.push(r.id);
        out.closed++;
      }
      for (const td of t.todos ?? []) {
        const text = td.text?.trim();
        if (!text) continue;
        const values = {
          text: text.slice(0, 500),
          kind: isTodoKind(td.kind) ? td.kind : "other",
          owner: td.owner === "other" ? "other" : "me",
          source: td.source?.trim().slice(0, 200) || null,
          refs: JSON.stringify((td.refs ?? []).map((r) => String(r).trim().replace(/^\[|\]$/g, "")).filter((r) => /^(jira-comment|teams|gitlab|mail|keep):./.test(r)).slice(0, 15)),
          ops: "[]",
          runId,
          updatedAt: now,
          // A deadline it names; none named: the one it has stays (yours, set by hand).
          ...(dueDay(td.due) ? { due: dueDay(td.due) } : {}),
        };
        const plan = cleanPlan(td.then, ticket);
        if (td.id && open.has(td.id)) {
          // Kept: its operations stay as they are (the auto-actions', a delivery's) — and with
          // Zeff's own delivery steps, its kind and owner too (the AI doesn't know them).
          const before = tx.select({ ops: todos.ops, kind: todos.kind, owner: todos.owner }).from(todos).where(eq(todos.id, td.id)).get();
          const had = cleanOps(parse<unknown[]>(before?.ops ?? "[]", []), ticket);
          const delivery = had.some((o) => (DELIVERY_OP_TYPES as readonly string[]).includes(o.type));
          const keep = delivery ? { ops: before!.ops, kind: before!.kind, owner: before!.owner } : { ops: before?.ops ?? "[]" };
          // Its plan: the new one, else the one it has.
          tx.update(todos).set({ ...values, ...keep, ...(plan.length ? { planned: JSON.stringify(plan) } : {}) }).where(eq(todos.id, td.id)).run();
          open.delete(td.id);
          out.kept++;
        } else {
          // Already open (here or on another ticket — the same message, the same numbers, the same
          // words): not made twice; what this one came from goes onto that one.
          const dup = duplicateTodo({ text: values.text, ops: JSON.parse(values.ops) as TodoOp[] }, openAll);
          if (dup) {
            const own = dup.refs.filter((r) => !dup.mailRefs.includes(r)); // the related mails stay in their own column
            const refs = [...new Set([...own, ...(JSON.parse(values.refs) as string[])])].slice(0, 15);
            tx.update(todos).set({ refs: JSON.stringify(refs), updatedAt: now }).where(eq(todos.id, dup.id)).run();
            // On another ticket: the two tickets are about the same thing — linked on the todo (the original its main one).
            if (dup.ticket !== ticket) linkTodoTicket(dup.id, ticket, tx);
            out.kept++;
            continue;
          }
          const row = tx.insert(todos).values({ ticket, ...values, planned: JSON.stringify(plan) }).returning().get();
          openAll.push(toTodo(row));
          out.added++;
        }
      }
    }
  });
  for (const id of resolved) afterDone(id);
  return out;
}

/** A ticket that's done in Jira: its open todos close with it. How many. */
export function closeTodosOfDoneTickets(tickets: string[]): number {
  if (!tickets.length) return 0;
  const now = new Date().toISOString();
  return getDb()
    .update(todos)
    .set({ status: "done", note: "Ticket in Jira erledigt.", doneAt: now, updatedAt: now })
    .where(and(eq(todos.status, "open"), inArray(todos.ticket, tickets)))
    .returning()
    .all().length;
}
