// "Do in Zeff" (what plugins offer to the AI): the checks of the actions an AI proposes are registered by this.
import "@/plugins/actions/server";
import { parseTodoKnowledge, type TodoKnowledge } from "@/plugins/knowledge/shared";
import { summaryForTicket } from "@/plugins/knowledge/repo-systems-store";
import { repeatsByRecord, similarText } from "./similar";
import { parseTodoRecurrence } from "@/lib/calendar/recurrence";
import { spawnNext, syncSeries } from "./recurring";
import { absorb, mergeInto } from "./merge";
import { jiraNoteBody } from "@/plugins/people/accounts";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { emitChange } from "@/lib/events";
import type { BoardRun, BoardSettings, Todo } from "@/db/schema";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { runTodoDoneHooks } from "./done-hooks";
import { resolveRefs, unresolveRefs } from "@/lib/resolved";
import { cleanOps, cleanPlan, DELIVERY_OP_TYPES, dueDay, isTodoKind, parseTodoRef, todoRef, type BoardResult, type BoardRunView, type BoardTicket, type TodoOp, type TodoPath, type TodoStatus, type TodoStep, type TodoView } from "./shared";

const { boardSettings, boardRuns, todos, todoLinks, gitlabItems } = schema;

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
  // What it says about each ticket, into the Lage fields of the Workspace's rows with its key (the cards read the fields).
  if (patch.status === "ok" && patch.result?.tickets?.length) {
    const tickets = patch.result.tickets;
    void import("@/plugins/state")
      .then(async ({ isInstalled }) => (isInstalled("workspace") ? (await import("@/plugins/workspace/lage-fields")).applyTicketLage(tickets) : 0))
      .catch((e) => console.error("[boards] the Lage into the Workspace's fields failed", e));
  }
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

/** A note's ref: a note (keep:…) or a database row (page:…) — an item of a collection. */
const isNoteRef = (r: string) => r.startsWith("keep:") || /^page:\d+$/.test(r);

/**
 * What a todo is related to, by the relation runs (its mail_refs column): the mails (Mail-Zuordnung,
 * "mail:…") and the notes (Notiz-Zuordnung, Keep's extension, "keep:…" and database rows "page:…").
 */
const relatedRefsOf = (r: Todo) => parse<string[]>(r.mailRefs, []).filter((k) => typeof k === "string" && (k.startsWith("mail:") || isNoteRef(k) || k.startsWith("doc:") || k.startsWith("cal:")));
/** The mails related to a todo (by the mail relation run). */
const mailRefsOf = (r: Todo) => relatedRefsOf(r).filter((k) => k.startsWith("mail:"));

/**
 * What a todo has recorded on its own (the todo_links): the feature branches its work is on — their GitLab
 * branch and merge requests are its context, derived here, so nothing that rewrites the todo can drop them —
 * and the context items you took out by hand (they stay out).
 */
type TodoLinksOf = { branchRefs: string[]; dismissed: Set<string> };
function linksOf(id: number): TodoLinksOf {
  return linksOfMany([id]).get(id)!;
}

/** linksOf for many todos at once: two queries in all (chunked), not two per todo. */
function linksOfMany(ids: number[]): Map<number, TodoLinksOf> {
  const out = new Map<number, TodoLinksOf>(ids.map((id) => [id, { branchRefs: [], dismissed: new Set<string>() }]));
  const db = getDb();
  const names = new Set<string>();
  const branchesOf = new Map<number, string[]>();
  for (let i = 0; i < ids.length; i += 400) {
    for (const l of db.select().from(todoLinks).where(inArray(todoLinks.todoId, ids.slice(i, i + 400))).all()) {
      if (l.kind === "dismissed") out.get(l.todoId)?.dismissed.add(l.value);
      else if (l.kind === "branch") {
        names.add(l.value);
        branchesOf.set(l.todoId, [...(branchesOf.get(l.todoId) ?? []), l.value]);
      }
    }
  }
  if (!names.size) return out;
  const items: { key: string; kind: string; branch: string | null; ref: string }[] = [];
  const all = [...names];
  for (let i = 0; i < all.length; i += 400) {
    const part = all.slice(i, i + 400);
    items.push(...db.select({ key: gitlabItems.key, kind: gitlabItems.kind, branch: gitlabItems.branch, ref: gitlabItems.ref }).from(gitlabItems).where(or(inArray(gitlabItems.branch, part), inArray(gitlabItems.ref, part))).all().filter((x) => x.kind === "branch" || x.kind === "mr"));
  }
  for (const [id, mine] of branchesOf) {
    const wanted = new Set(mine);
    out.get(id)!.branchRefs = items.filter((x) => (x.branch && wanted.has(x.branch)) || wanted.has(x.ref)).map((x) => `gitlab:${x.key}`);
  }
  return out;
}

/** Todos built from rows: their links read together. */
const toTodos = (rows: Todo[]): TodoView[] => {
  linkBatch = linksOfMany(rows.map((r) => r.id));
  try {
    return rows.map(toTodo);
  } finally {
    linkBatch = null;
  }
};
let linkBatch: Map<number, TodoLinksOf> | null = null;

/**
 * A note synced to Jira, marked when what would go there now differs from the comment (its text with the people
 * it tags as mentions is hashed, as at the sync) — the note changed, or who a tagged person is did. Others as they are.
 */
function withJiraStale(n: TodoView["userNotes"][number]): TodoView["userNotes"][number] {
  if (!n.jiraCommentId || n.by || n.kind === "instruction") return n;
  try {
    return { ...n, jiraStale: jiraNoteBody(n.text).hash !== n.jiraHash };
  } catch {
    return n;
  }
}

/** The summary of the repo the todo's ticket goes to (its deployments, what the knowledge says) joins its knowledge — written once per repo, not per todo. */
function withRepoSystems(k: TodoKnowledge | null, ticket: string | null): TodoKnowledge | null {
  const repo = summaryForTicket(ticket);
  if (!repo) return k;
  return { at: k?.at ?? "", pages: k?.pages ?? [], entities: k?.entities ?? [], links: k?.links, repo };
}

const toTodo = (r: Todo): TodoView => {
  const { branchRefs, dismissed } = linkBatch?.get(r.id) ?? linksOf(r.id);
  const shown = (refs: string[]) => refs.filter((k) => !dismissed.has(k));
  return {
  id: r.id,
  ref: todoRef(r.id),
  due: r.due ?? null,
  knowledge: withRepoSystems(parseTodoKnowledge(r.knowledge), r.ticket),
  ticket: r.ticket,
  text: r.text,
  kind: isTodoKind(r.kind) ? r.kind : "other",
  owner: r.owner === "other" ? "other" : "me",
  status: r.status === "done" || r.status === "dismissed" ? r.status : "open",
  source: r.source,
  // What it came from (the Ticket-Lage's pick), then the mails and notes related to it.
  refs: [...new Set(shown([...parse<string[]>(r.refs, []), ...relatedRefsOf(r), ...branchRefs]))],
  mailRefs: shown(mailRefsOf(r)),
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
  userNotes: parse<TodoView["userNotes"]>(r.userNotes, []).filter((n) => n && typeof n.text === "string").map(withJiraStale),
  deferredAt: r.deferredAt ?? null,
  flaggedAt: r.flaggedAt ?? null,
  workerDone: parse<TodoView["workerDone"]>(r.workerDone ?? "null", null),
  byWorker: !!r.byWorker,
  alsoTickets: parse<string[]>(r.alsoTickets, []).filter((k) => typeof k === "string"),
  recurrence: parseTodoRecurrence(r.recurrence),
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
  doneAt: r.doneAt && iso(r.doneAt),
  mergedInto: r.mergedInto ?? null,
  mergedAt: r.mergedAt && iso(r.mergedAt),
  };
};

/** Record that a todo's work is on this branch (once; the repo's folder helps to find it). Whether it was new. */
export function recordBranch(todoId: number, branch: string, repo: string | null, source: string): boolean {
  const value = branch.replace(/^origin\//, "").trim();
  if (!value) return false;
  const r = getDb().insert(todoLinks).values({ todoId, kind: "branch", value, repo, source, createdAt: new Date().toISOString() }).onConflictDoNothing().run();
  if (r.changes) emitChange("todos");
  return r.changes > 0;
}

/** The branches recorded for a todo. */
export function todoBranches(todoId: number) {
  return getDb().select().from(todoLinks).where(and(eq(todoLinks.todoId, todoId), eq(todoLinks.kind, "branch"))).orderBy(todoLinks.id).all();
}

/**
 * Take a context item out of a todo by hand: gone from its context, and it stays gone — whoever
 * cites it again (a briefing run, a relation step, a sync).
 */
export function dismissTodoContext(todoId: number, ref: string): void {
  const value = ref.trim();
  if (!value) return;
  getDb().insert(todoLinks).values({ todoId, kind: "dismissed", value, source: "you", createdAt: new Date().toISOString() }).onConflictDoNothing().run();
  const row = getDb().select({ refs: todos.refs, mailRefs: todos.mailRefs }).from(todos).where(eq(todos.id, todoId)).get();
  if (row) {
    const drop = (json: string) => JSON.stringify(parse<string[]>(json, []).filter((k) => k !== value));
    getDb().update(todos).set({ refs: drop(row.refs), mailRefs: drop(row.mailRefs), updatedAt: new Date().toISOString() }).where(eq(todos.id, todoId)).run();
  }
  emitChange("todos");
}

/** Todos, oldest first: of a ticket, in a state ("all": any). */
/**
 * A relation run's pick: per todo, what it's about — its refs of one kind ("mail:" / "keep:")
 * replaced, the other kind's kept. Todos not in `picks` keep theirs.
 */
function setRelatedRefs(accept: (ref: string) => boolean, picks: Map<number, string[]>): number {
  if (!picks.size) return 0;
  let changed = 0;
  getDb().transaction((tx) => {
    for (const [id, refs] of picks) {
      const row = tx.select({ mailRefs: todos.mailRefs }).from(todos).where(eq(todos.id, id)).get();
      if (!row) continue;
      // Added to what it's related to already — that stays until you dismiss it.
      const had = parse<string[]>(row.mailRefs, []).filter((k) => typeof k === "string");
      const json = JSON.stringify([...new Set([...had, ...refs.filter(accept)])].slice(-40));
      const r = tx.update(todos).set({ mailRefs: json }).where(and(eq(todos.id, id), sql`${todos.mailRefs} <> ${json}`)).run();
      changed += r.changes;
    }
  });
  if (changed) emitChange("todos");
  return changed;
}

/** The mail relation run's pick: per todo, the mails it's about (["mail:<key>"]); its notes stay. */
export const setTodoMailRefs = (picks: Map<number, string[]>) => setRelatedRefs((r) => r.startsWith("mail:"), picks);

/** The Notiz-Zuordnung's pick (Keep's extension): per todo, the notes it's about (["keep:…"]); its mails stay. */
export const setTodoNoteRefs = (picks: Map<number, string[]>) => setRelatedRefs(isNoteRef, picks);

/** The Dokument-Zuordnung's pick (the Documents plugin's extension): per todo, the documents it's about (["doc:12"]); its mails and notes stay. Documents attached by hand are in its refs — not touched. */
export const setTodoDocRefs = (picks: Map<number, string[]>) => setRelatedRefs((r) => r.startsWith("doc:"), picks);

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

export function listTodos(opts: { ticket?: string; status?: TodoStatus | "all"; tickets?: string[]; /** Closed on or after this day (YYYY-MM-DD; a day's slack is the caller's) - without reading all the others. */ doneSince?: string; /** Open, or closed on or after this day. */ openOrDoneSince?: string; byWorker?: boolean } = {}): TodoView[] {
  const status = opts.status ?? "open";
  const where = and(
    status === "all" ? undefined : eq(todos.status, status),
    opts.ticket ? onTicket(opts.ticket.trim().toUpperCase()) : undefined,
    opts.doneSince ? sql`${todos.doneAt} >= ${opts.doneSince}` : undefined,
    opts.openOrDoneSince ? or(eq(todos.status, "open"), sql`${todos.doneAt} >= ${opts.openOrDoneSince}`) : undefined,
    opts.byWorker === undefined ? undefined : eq(todos.byWorker, opts.byWorker),
    opts.tickets ? (opts.tickets.length ? or(...opts.tickets.map((k) => onTicket(k.trim().toUpperCase()))) : eq(todos.ticket, "")) : undefined,
  );
  return toTodos(getDb().select().from(todos).where(where).orderBy(todos.id).all());
}

/**
 * What the related-notes lookup needs of the todos on these tickets (all states): who follows whom, what
 * they cite, their notes - without building whole todos (their links, their plans ...) for it.
 */
export function todoNoteIndex(tickets: string[]): Map<string, { id: number; parentId: number | null; refs: string[]; userNotes: TodoView["userNotes"] }[]> {
  const out = new Map<string, { id: number; parentId: number | null; refs: string[]; userNotes: TodoView["userNotes"] }[]>();
  for (const ticket of new Set(tickets)) {
    out.set(
      ticket,
      getDb()
        .select({ id: todos.id, parentId: todos.parentId, refs: todos.refs, userNotes: todos.userNotes })
        .from(todos)
        .where(ticket ? onTicket(ticket.trim().toUpperCase()) : undefined)
        .orderBy(todos.id)
        .all()
        .map((r) => ({
          id: r.id,
          parentId: r.parentId ?? null,
          refs: parse<string[]>(r.refs, []).filter((k) => typeof k === "string"),
          userNotes: parse<TodoView["userNotes"]>(r.userNotes, []).filter((n) => n && typeof n.text === "string"),
        })),
    );
  }
  return out;
}

/** These tickets' todos as the Todos page shows them: the open ones, and those closed in the last `days`. */
export function boardTodos(tickets: string[], days = 7): TodoView[] {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  // (Closed ones older than the window are not even read: the cut by day is a day wider than the exact test below.)
  return listTodos({ status: "all", tickets, openOrDoneSince: since.slice(0, 10) }).filter((t) => !t.byWorker && !t.mergedInto && (t.status === "open" || (t.doneAt ?? "") >= since));
}

/** The workers' own todos (the Todos page's "Worker" tab): the open ones, then those closed lately — newest first. */
export function workerTodos(days = 14): TodoView[] {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  return listTodos({ status: "all", openOrDoneSince: since.slice(0, 10), byWorker: true })
    .filter((t) => t.byWorker && !t.mergedInto && (t.status === "open" || (t.doneAt ?? "") >= since))
    .sort((a, b) => Number(b.status === "open") - Number(a.status === "open") || b.id - a.id);
}

/** Done and dismissed todos, the latest first — all of them (up to `limit`). */
export function doneTodos(limit = 300): TodoView[] {
  return toTodos(getDb()
    .select()
    .from(todos)
    .where(and(inArray(todos.status, ["done", "dismissed"]), eq(todos.byWorker, false), isNull(todos.mergedInto)))
    .orderBy(desc(todos.doneAt), desc(todos.id))
    .limit(limit)
    .all());
}

/**
 * The todos you dropped in the last `days` (dismissed by you, not by a run or another path taken):
 * the reviews don't propose one like them again — a new message in the same conversation isn't
 * reason enough.
 */
export function droppedByYou(days = 60): TodoView[] {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  return toTodos(getDb()
    .select()
    .from(todos)
    .where(
      and(
        eq(todos.status, "dismissed"),
        sql`${todos.doneAt} >= ${since}`,
        sql`(select e.actor from todo_events e where e.todo_id = ${todos.id} and e.event = 'dismissed' order by e.id desc limit 1) = 'you'`,
      ),
    )
    .all());
}

/** How many todos are done or dismissed (up to `limit`, the newest), and their tickets — without reading them whole. */
export function doneTodoTickets(limit = 300): { count: number; tickets: string[] } {
  const rows = getDb()
    .select({ ticket: todos.ticket })
    .from(todos)
    .where(and(inArray(todos.status, ["done", "dismissed"]), eq(todos.byWorker, false), isNull(todos.mergedInto)))
    .orderBy(desc(todos.doneAt), desc(todos.id))
    .limit(limit)
    .all();
  return { count: rows.length, tickets: [...new Set(rows.map((r) => r.ticket).filter(Boolean))] };
}

/** The todos with these ids, by id. */
export function todosByIds(ids: number[]): Map<number, TodoView> {
  const wanted = [...new Set(ids)].slice(0, 200);
  if (!wanted.length) return new Map();
  return new Map(toTodos(getDb().select().from(todos).where(inArray(todos.id, wanted)).all()).map((t) => [t.id, t]));
}

/**
 * Todos for the context search: matching words (text, ticket, note) or a reference ("T-12") —
 * done ones first (newest first), then open ones. Done work is what backs an entry.
 */
export function searchTodos(q: string, limit = 8): TodoView[] {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const ref = parseTodoRef(q);
  const all = toTodos(getDb().select().from(todos).where(inArray(todos.status, ["done", "open"])).orderBy(desc(todos.id)).limit(500).all());
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
  const db = getDb();
  const before = getTodo(id);
  if (!before) throw new NotFoundError(t("Todo {ref} not found.", { ref: todoRef(id) }));
  if (status !== "open") resolveRefs(before.refs, before.ticket);
  else if (before.status !== "open") unresolveRefs(before.refs, before.ticket); // taken back: they're open again
  const now = new Date().toISOString();
  db.update(todos)
    .set({
      status,
      updatedAt: now,
      doneAt: status === "open" ? null : now,
      workerDone: null, // closed or opened again by whoever decides: the worker's say is settled
      ...(note !== undefined ? { note: note?.trim().slice(0, 500) || null } : {}),
    })
    .where(eq(todos.id, id))
    .run();
  if (status === "done" && before.status !== "done") {
    afterDone(id);
    runTodoDoneHooks(id);
    // A todo that comes back (a rate on the 15th): the next one is there.
    if (before.recurrence) spawnNext(id);
  }
  // After the status and the follow-ups it brings are written: a page that refreshes on this finds both the closed todo and the next one.
  emitChange("todos");
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
      .set({ status: "dismissed", note: `Another path chosen (${t.path}, ${t.ref}).`, doneAt: now, updatedAt: now })
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
      source: `Planned after ${t.ref}`,
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
 * An implementation's delivery — after you've tested it, and only once the implementation is
 * ticked off: its plan ("Then") gets the test-and-verify-by-hand step (no buttons: that's yours)
 * and behind it the delivery (push → merge request, or merge into main), which appears with its
 * buttons once the test is ticked off. What was planned after the implementation goes on after
 * the delivery (minus the testing, review and merge it covers). Nothing shows up in the lists
 * before that — the worker only suggests the todo as done. The todo (with its plan now).
 */
export function addTestedDelivery(v: { from: TodoView; workRunId: number | null; source: string; branch: string; delivery: { text: string; ops: TodoOp[] } }): TodoView {
  const test: TodoStep = { text: `Test and verify by hand (${v.branch}): ${v.from.text}`.slice(0, 500), kind: "test", owner: "me", ops: [] };
  const step: TodoStep = { text: v.delivery.text, kind: "merge", owner: "me", ops: v.delivery.ops };
  // One way on: the delivery decides MR or direct merge, so plans that differed in that are alike now — the first stays.
  const rest = planAfter(v.from, ["test", "review", "merge"])[0];
  const planned: TodoPath[] = [{ path: null, steps: [test, step, ...(rest?.steps ?? [])].slice(0, 7) }];
  getDb().update(todos).set({ planned: JSON.stringify(planned), updatedAt: new Date().toISOString() }).where(eq(todos.id, v.from.id)).run();
  emitChange("todos");
  return getTodo(v.from.id)!;
}

/** Whether an open todo delivers this branch — now (its operations) or once it's done (its planned steps'). */
export function deliversBranch(t: TodoView, branch: string): boolean {
  const names = (ops: TodoOp[]) => ops.some((o) => ("branch" in o && o.branch.replace(/^origin\//, "") === branch) || ("source" in o && o.source === branch));
  return names(t.ops) || t.planned.some((p) => p.steps.some((s) => names(s.ops)));
}

/** How long a todo closed lately (done, or dismissed by you) counts as "made already" for what an AI or a worker would make again. */
const RECENTLY_CLOSED_DAYS = 3;

/**
 * The todo a new one would only repeat — so whatever makes todos (the briefing, a worker's follow-ups, a plan's next
 * step, the mail, note and document reviews) makes none twice: an open todo on the ticket with mostly the same words
 * (or one that says what the new one says as a part), or the same message / numbers on record (any ticket); one that has
 * it planned as a step (`planned`, default on); and with `closed`: one done or dismissed in the last days — what you have
 * dealt with isn't made again. Undefined: it's new.
 */
export function existingTodoFor(
  c: { ticket: string; text: string; ops?: unknown[]; target?: string | null },
  opts: { closed?: boolean; planned?: boolean; skipId?: number | null } = {},
): TodoView | undefined {
  const ticket = c.ticket.trim().toUpperCase();
  const text = c.text.trim();
  const ops = cleanOps(c.ops, ticket);
  const onTicket = (t: TodoView) => (ticket ? t.ticket === ticket || t.alsoTickets.includes(ticket) : !t.ticket);
  const open = listTodos({ status: "open" }).filter((t) => t.id !== opts.skipId);
  const byWords = open.find((t) => repeatsByRecord({ text, ops }, t) || (onTicket(t) && similarText(text, t.text)));
  if (byWords) return byWords;
  if (opts.planned !== false) {
    const planned = open.find((t) => onTicket(t) && t.planned.some((p) => p.steps.some((s) => similarText(text, s.text))));
    if (planned) return planned;
  }
  if (opts.closed) {
    const since = new Date(Date.now() - RECENTLY_CLOSED_DAYS * 864e5).toISOString();
    return listTodos({ status: "all" }).find((t) => t.status !== "open" && !t.mergedInto && onTicket(t) && (t.doneAt ?? "") >= since && similarText(text, t.text));
  }
  return undefined;
}

/** What a repeated todo's new try brings to the one it repeats: the messages it came from are its sources too. */
function addRefsTo(todo: TodoView, refs: string[]): void {
  const fresh = refs.filter((r) => !todo.refs.includes(r));
  if (!fresh.length || todo.status !== "open") return;
  const row = getDb().select({ refs: todos.refs }).from(todos).where(eq(todos.id, todo.id)).get();
  getDb().update(todos).set({ refs: JSON.stringify([...new Set([...parse<string[]>(row?.refs ?? "[]", []), ...fresh])].slice(-40)) }).where(eq(todos.id, todo.id)).run();
}

/** Steps planned behind a todo that repeats another: put onto that one, the ones it doesn't plan already. */
function planOnto(todoId: number, steps: TodoStep[]): void {
  const t = getTodo(todoId);
  if (!t || t.status !== "open" || !steps.length) return;
  const have = t.planned.flatMap((p) => p.steps);
  const fresh = steps.filter((s) => !have.some((h) => similarText(h.text, s.text)));
  if (!fresh.length) return;
  const planned: TodoPath[] = t.planned.length ? [{ ...t.planned[0], steps: [...t.planned[0].steps, ...fresh].slice(0, 7) }, ...t.planned.slice(1)] : [{ path: null, steps: fresh.slice(0, 7) }];
  getDb().update(todos).set({ planned: JSON.stringify(planned), updatedAt: new Date().toISOString() }).where(eq(todos.id, todoId)).run();
}

/** A todo as a creation path hands it over to the gate. */
export type TodoCandidate = {
  ticket: string;
  text: string;
  kind?: string;
  owner?: "me" | "other";
  ops?: unknown[];
  refs?: string[];
  mailRefs?: string[];
  due?: string | null;
  draft?: string | null;
  channel?: string | null;
  target?: string | null;
  planned?: TodoView["planned"];
  runId?: number | null;
  workRunId?: number | null;
  byWorker?: boolean;
  /** Where it comes from, in words (the history says it: "Mail-Durchsicht", "Follow-up from W-45"). */
  source: string | null;
  actor?: string | null;
};

/** What a creation path gets back: the todo, and what became of the candidate ("merged" into an older open todo; "known": it repeats one dealt with or planned - nothing made; none: a new todo). */
export type Gated = TodoView & { outcome?: "merged" | "known" };

/**
 * THE gate every todo creation goes through before it inserts a row. A candidate that repeats open todos
 * (the same message / numbers on record, or mostly the same words - on any ticket) makes no row: the OLDEST
 * of them keeps its id and absorbs it (refs, operations, the earlier deadline, its wording as a note - see
 * absorb), and any further open duplicates already there are merged into that oldest too. The survivor is
 * touched (new to you again) and its history says what came from where. A candidate that repeats a todo planned
 * as a step, or one done / dropped lately (`closed`), is "known": nothing is made, nothing merged into closed
 * ones. `skipId`: a todo that never takes the candidate (a follow-up's parent that its run is closing - the
 * follow-up exists because of it). Null: it's new, the caller inserts it.
 */
export function gateTodo(c: TodoCandidate, opts: { closed?: boolean; planned?: boolean; skipId?: number | null; anyTicket?: boolean } = {}): Gated | null {
  const ticket = c.ticket.trim().toUpperCase();
  const text = c.text.trim();
  const ops = cleanOps(c.ops, ticket);
  // The same message / numbers is the same anywhere; mostly the same words only on its own ticket - except the Ticket-Lage's
  // (`anyTicket`: it says the same thing on two tickets, which then get linked on the todo).
  const here = (t: TodoView) => (ticket ? t.ticket === ticket || t.alsoTickets.includes(ticket) : !t.ticket);
  const same = listTodos({ status: "open" }).filter(
    (t) => t.id !== opts.skipId && (repeatsByRecord({ text, ops }, t) || (similarText(text, t.text) && (here(t) || opts.anyTicket))),
  );
  if (same.length) {
    const [oldest, ...rest] = same;
    const actor = c.actor ?? (c.workRunId ? `work:${c.workRunId}` : c.runId ? `lage:${c.runId}` : null);
    absorb(oldest.id, { ...c, ticket, text, ops, actor, from: c.source ?? "" });
    for (const r of rest) mergeInto(oldest.id, r.id, actor);
    // The same thing on another ticket: the tickets are linked on the todo (the original its main one).
    if (ticket && oldest.ticket !== ticket && !oldest.alsoTickets.includes(ticket)) linkTodoTicket(oldest.id, ticket);
    // A todo a worker made, wanted by you now: it comes onto your list.
    if (oldest.byWorker && c.byWorker === false) getDb().update(todos).set({ byWorker: false }).where(eq(todos.id, oldest.id)).run();
    emitChange("todos");
    return { ...getTodo(oldest.id)!, outcome: "merged" };
  }
  const had = existingTodoFor({ ticket, text, ops, target: c.target }, opts);
  if (!had) return null;
  if (had.status === "open") {
    planOnto(had.id, c.planned?.flatMap((p) => p.steps) ?? []);
    addRefsTo(had, c.refs ?? []);
  }
  return { ...had, outcome: "known" };
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
  parentId: number | null;
  workRunId: number | null;
  source: string;
  ops?: unknown[];
  /** A worker's own todo (its follow-up): on the Worker tab, not in your list. */
  byWorker?: boolean;
  /** other: waiting for someone else first (a merge request's approval). */
  owner?: "me" | "other";
  /** What comes after it (a planned step's rest), and the alternative path it's on. */
  planned?: TodoView["planned"];
  path?: string | null;
}): Gated {
  const target = v.target?.trim() || null;
  const refs = target && /^(jira-comment|teams|gitlab):./.test(target) ? [target] : [];
  // What a worker or a plan makes again isn't made: the todo it repeats absorbs it (its plan takes what comes after).
  // Its parent - the todo its run has just marked done (or closed) - is the follow-up's reason, never its twin: that one isn't merged into.
  const parent = v.parentId ? getTodo(v.parentId) : undefined;
  const g = gateTodo(
    { ticket: v.ticket, text: v.text, kind: v.kind, owner: v.owner, ops: v.ops, refs, draft: v.draft, channel: v.channel, target, planned: v.planned, workRunId: v.workRunId, byWorker: !!v.byWorker, source: v.source },
    { closed: !!v.byWorker || /^Follow-up from/.test(v.source), planned: !/^Planned after/.test(v.source), skipId: parent && (parent.status !== "open" || parent.workerDone) ? parent.id : null },
  );
  if (g) return g;
  const now = new Date().toISOString();
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
      byWorker: !!v.byWorker,
      ops: JSON.stringify(cleanOps(v.ops, v.ticket.trim().toUpperCase())),
      planned: JSON.stringify(v.planned ?? []),
      path: v.path ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  emitChange("todos"); // (after it is written: a page that refreshes on it must find it)
  return toTodo(row);
}


/**
 * A todo the Mail-Durchsicht found in a mail (a training to do, a form to fill in …): on a ticket
 * when it's about one, else on none (ticket "") — with the mails it came from.
 */
export function addMailTodo(v: { ticket: string; text: string; kind: string; owner?: "me" | "other"; refs: string[]; runId: number | null; due?: string | null }): Gated {
  const g = gateTodo({ ticket: v.ticket, text: v.text, kind: v.kind, owner: v.owner, refs: v.refs.filter((r) => r.startsWith("mail:") || r.startsWith("fact:")), due: v.due, runId: v.runId, byWorker: false, source: "Mail-Durchsicht" }, { closed: true });
  if (g) return g;
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
  emitChange("todos"); // (after it is written: a page that refreshes on it must find it)
  return toTodo(row);
}

/** A todo from the Notiz-Durchsicht (Keep's extension): what a note asks of you, the notes as its source. */
/** A todo from a document (the Dokument-Durchsicht): what the document asks of you, due when it says so; the document is its source. */
export function addDocTodo(v: { ticket: string; text: string; kind: string; owner?: "me" | "other"; refs: string[]; runId: number | null; due?: string | null }): Gated {
  const g = gateTodo({ ticket: v.ticket, text: v.text, kind: v.kind, owner: v.owner, refs: v.refs.filter((r) => r.startsWith("doc:")), due: v.due, runId: v.runId, byWorker: false, source: "Dokument-Durchsicht" }, { closed: true });
  if (g) return g;
  const now = new Date().toISOString();
  const row = getDb()
    .insert(todos)
    .values({
      ticket: v.ticket.trim().toUpperCase(),
      text: v.text.trim().slice(0, 500),
      kind: isTodoKind(v.kind) ? v.kind : "other",
      owner: v.owner === "other" ? "other" : "me",
      status: "open",
      source: "Dokument-Durchsicht",
      refs: JSON.stringify(v.refs.filter((r) => r.startsWith("doc:")).slice(0, 15)),
      runId: v.runId,
      due: dueDay(v.due),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  emitChange("todos"); // (after it is written: a page that refreshes on it must find it)
  return toTodo(row);
}

export function addNoteTodo(v: { ticket: string; text: string; kind: string; owner?: "me" | "other"; refs: string[]; runId: number | null; due?: string | null }): Gated {
  const g = gateTodo({ ticket: v.ticket, text: v.text, kind: v.kind, owner: v.owner, refs: v.refs.filter(isNoteRef), due: v.due, runId: v.runId, byWorker: false, source: "Notiz-Durchsicht" }, { closed: true });
  if (g) return g;
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
      refs: JSON.stringify(v.refs.filter(isNoteRef).slice(0, 15)),
      runId: v.runId,
      due: dueDay(v.due),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  emitChange("todos"); // (after it is written: a page that refreshes on it must find it)
  return toTodo(row);
}

/** A todo you add yourself (a Kanban card's checklist): yours, on that ticket. */
/**
 * A todo from a calendar appointment (its calendar set to "Todos"): the appointment's title, due on
 * its day; `ref` ("event:<id>@<day>") says which — none twice for the same.
 */
export function addCalendarTodo(v: { text: string; due: string; ref: string; source: string }): TodoView | null {
  if (getDb().select({ id: todos.id }).from(todos).where(sql`${todos.refs} like ${`%"${v.ref}"%`}`).get()) return null;
  // (No gate: each occurrence is its own todo on its own day - "Daily (09:00)" repeats by nature, and its ref says which.)
  const now = new Date().toISOString();
  const row = getDb()
    .insert(todos)
    .values({ ticket: "", text: v.text.trim().slice(0, 500), kind: "other", owner: "me", status: "open", source: v.source.slice(0, 200), refs: JSON.stringify([v.ref]), runId: null, due: dueDay(v.due), createdAt: now, updatedAt: now })
    .returning()
    .get();
  emitChange("todos"); // (after it is written: a page that refreshes on it must find it)
  return toTodo(row);
}

/** The todo that carries a reference ("ws:12" - a row of a Workspace todo list), done or not. */
export function todoByRef(ref: string): TodoView | undefined {
  const r = getDb().select().from(todos).where(sql`${todos.refs} like ${`%"${ref}"%`}`).get();
  return r ? toTodo(r) : undefined;
}

export function addManualTodo(v: { ticket: string; text: string }): Gated {
  const g = gateTodo({ ticket: v.ticket, text: v.text, byWorker: false, source: "From you", actor: "you" });
  if (g) return g;
  const now = new Date().toISOString();
  const row = getDb()
    .insert(todos)
    .values({ ticket: v.ticket.trim().toUpperCase(), text: v.text.trim().slice(0, 500), kind: "other", owner: "me", status: "open", source: "From you", refs: "[]", runId: null, createdAt: now, updatedAt: now })
    .returning()
    .get();
  emitChange("todos"); // (after it is written: a page that refreshes on it must find it)
  return toTodo(row);
}

/**
 * The todo a new work session belongs on, when the instruction or the ticket says which: the open todo of
 * yours it names ("T-165"), else the only open todo of yours on the ticket. Not a worker's, not a placeholder.
 */
export function findSessionTodo(instruction: string, ticket: string): TodoView | undefined {
  const mine = (t: TodoView | undefined) => (t && t.status === "open" && t.owner === "me" && !t.byWorker ? t : undefined);
  for (const m of instruction.matchAll(/\bT-(\d+)\b/gi)) {
    const t = mine(getTodo(Number(m[1])));
    if (t) return t;
  }
  const key = ticket.trim().toUpperCase();
  if (!key) return undefined;
  const open = listTodos({ status: "open", ticket: key }).filter((t) => t.owner === "me" && !t.byWorker);
  return open.length === 1 ? open[0] : undefined;
}

/**
 * A placeholder todo for a work session that belongs to no todo (Work: a new session — on a ticket, or none):
 * it carries the session, stays in the Worker tab (never in yours), and offers one action — "Create todo" with
 * your instruction's first line as the title — that makes it a todo of yours (promoteSessionTodo).
 */
/** The source an agent's own todos carry — what lets it tick them off itself (and only those). */
export const AGENT_SOURCE = "From agent";

/**
 * A step the agent writes on the ticket as a todo (add_todo): in your list like any other, open — so you can add more and send the
 * agent for another round. One that repeats an open todo is that todo (the gate), never a second.
 */
export function addAgentTodo(v: { ticket: string; text: string; owner?: "me" | "other" }): Gated {
  const g = gateTodo({ ticket: v.ticket, text: v.text, byWorker: false, source: AGENT_SOURCE, actor: "agent:MCP", owner: v.owner });
  if (g) return g;
  const now = new Date().toISOString();
  const row = getDb()
    .insert(todos)
    .values({ ticket: v.ticket.trim().toUpperCase(), text: v.text.trim().slice(0, 500), kind: "other", owner: v.owner ?? "me", status: "open", source: AGENT_SOURCE, refs: "[]", runId: null, createdAt: now, updatedAt: now })
    .returning()
    .get();
  emitChange("todos");
  return toTodo(row);
}

/**
 * The delivery of a branch (push, merge request) as a todo of its own with those actions. It does not go through the todo gate
 * (that folds a todo into a similar one of the ticket — the delivery would vanish into an unrelated todo); instead: an open todo that
 * already pushes this branch is that todo (it gets the merge request, if it has none), else a new one. `created`: a new todo was made.
 */
export function deliveryTodo(v: { ticket: string; text: string; runId: number | null; branch: string; ops: TodoOp[] }): { todo: TodoView; created: boolean } {
  const ticket = v.ticket.trim().toUpperCase();
  const existing = listTodos({ status: "open" }).find((t) => t.ticket === ticket && t.ops.some((o) => o.type === "git-push" && o.branch === v.branch));
  if (existing) {
    const mr = v.ops.find((o) => o.type === "gitlab-open-mr");
    const push = existing.ops.find((o) => o.type === "git-push");
    if (mr && push && push.type === "git-push" && !existing.ops.some((o) => o.type === "gitlab-open-mr")) {
      return { todo: setTodoOps(existing.id, [...existing.ops, { ...mr, source: push.remote }]), created: false };
    }
    return { todo: existing, created: false };
  }
  const now = new Date().toISOString();
  const row = getDb()
    .insert(todos)
    .values({ ticket, text: v.text.trim().slice(0, 500), kind: "merge", owner: "me", status: "open", source: v.runId ? `Follow-up from W-${v.runId}` : "Delivery", refs: "[]", ops: JSON.stringify(cleanOps(v.ops, ticket)), runId: v.runId, createdAt: now, updatedAt: now })
    .returning()
    .get();
  emitChange("todos");
  return { todo: toTodo(row), created: true };
}

/**
 * An agent ticks off a todo it has done — its own, and one you added on the ticket (you let it work through them): done, with its note,
 * and you can open it again. A closed one stays as it is.
 */
export function tickAgentTodo(id: number, note?: string | null): { todo: TodoView; ticked: boolean } {
  const t = getTodo(id);
  if (!t) throw new NotFoundError(`Todo ${todoRef(id)} not found.`);
  if (t.status !== "open") return { todo: t, ticked: false };
  return { todo: setTodoStatus(id, "done", note?.trim() || "Erledigt vom Agenten"), ticked: true };
}

export function addSessionTodo(v: { ticket: string; text: string }): Gated {
  const g = gateTodo({ ticket: v.ticket, text: v.text, byWorker: true, source: "Work-Session", actor: "you" });
  if (g) return g;
  const now = new Date().toISOString();
  const text = v.text.trim().slice(0, 500);
  const row = getDb()
    .insert(todos)
    .values({ ticket: v.ticket.trim().toUpperCase(), text, kind: "other", owner: "me", status: "open", source: "Work-Session", byWorker: true, ops: JSON.stringify([{ type: "todo-promote", text }]), refs: "[]", runId: null, createdAt: now, updatedAt: now })
    .returning()
    .get();
  emitChange("todos"); // (after it is written: a page that refreshes on it must find it)
  return toTodo(row);
}

/** A session's placeholder made a todo of yours (Todos tab): the title you want; its runs and time stay with it. */
export function promoteSessionTodo(id: number, text: string): TodoView {
  const t = getTodo(id);
  if (!t) throw new Error("No such todo.");
  const title = (text.trim() || t.text).slice(0, 500);
  getDb()
    .update(todos)
    .set({ byWorker: false, text: title, ops: JSON.stringify(t.ops.filter((o) => o.type !== "todo-promote")), updatedAt: new Date().toISOString() })
    .where(eq(todos.id, id))
    .run();
  emitChange("todos");
  return getTodo(id)!;
}

/** A todo's operations, replaced (e.g. merging straight into main instead of a merge request). */
/** A todo's text changed where it shows (the todo block): trimmed, not empty; the rest as it was. */
export function setTodoText(id: number, text: string): TodoView {
  const v = text.trim().slice(0, 500);
  if (!v) throw new ValidationError(t("A todo's text can't be empty."));
  getDb().update(todos).set({ text: v, updatedAt: new Date().toISOString() }).where(eq(todos.id, id)).run();
  emitChange("todos");
  return getTodo(id)!;
}

/** `keepWhy`: an action added beside the proposed ones (a transfer Zeff puts on a payment) — they stay proposed. */
export function setTodoOps(id: number, ops: TodoView["ops"], text?: string, keepWhy = false): TodoView {
  emitChange("todos");
  getDb()
    .update(todos)
    .set({ ops: JSON.stringify(ops), ...(keepWhy ? {} : { autoOpsWhy: null }), ...(text ? { text: text.slice(0, 500) } : {}), updatedAt: new Date().toISOString() })
    .where(eq(todos.id, id))
    .run();
  return getTodo(id)!;
}

/** Your note on a todo, added (context for whoever works on it) — or one taken away (by its time). */
export function addTodoUserNote(id: number, text: string): TodoView {
  const todo = getTodo(id);
  if (!todo) throw new NotFoundError(t("Todo {ref} not found.", { ref: todoRef(id) }));
  const note = text.trim().slice(0, 4000);
  if (!note) return todo;
  const notes = [...todo.userNotes, { at: new Date().toISOString(), text: note }];
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
  syncSeries(id); // (a todo that comes back: its calendar series starts on the new day)
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

/** Your note changed (it stays where it is; a note already on Jira is edited there at the next sync). */
export function updateTodoUserNote(id: number, at: string, text: string): TodoView {
  const todo = getTodo(id);
  if (!todo) throw new NotFoundError(t("Todo {ref} not found.", { ref: todoRef(id) }));
  const body = text.trim().slice(0, 4000);
  if (!body) throw new ValidationError(t("The note is empty."));
  if (!todo.userNotes.some((n) => n.at === at)) throw new NotFoundError(t("That note isn't there any more."));
  getDb().update(todos).set({ userNotes: JSON.stringify(todo.userNotes.map((n) => (n.at === at ? { ...n, text: body } : n))), updatedAt: new Date().toISOString() }).where(eq(todos.id, id)).run();
  emitChange("todos");
  return getTodo(id)!;
}

/** A note's comment on Jira, as it is now (its address becomes the note's link). */
export function markNoteSynced(id: number, at: string, v: { commentId: string; hash: string; url: string | null; text?: string; files?: number[] }): void {
  const todo = getTodo(id);
  if (!todo) return;
  const notes = todo.userNotes.map((n) => (n.at === at ? { ...n, jiraCommentId: v.commentId, jiraHash: v.hash, ...(v.text !== undefined ? { jiraText: v.text } : {}), ...(v.files ? { jiraFiles: v.files } : {}), ...(v.url ? { url: v.url, urlLabel: "Jira" } : {}) } : n));
  getDb().update(todos).set({ userNotes: JSON.stringify(notes) }).where(eq(todos.id, id)).run();
  emitChange("todos");
}

export function removeTodoUserNote(id: number, at: string): TodoView {
  const todo = getTodo(id);
  if (!todo) throw new NotFoundError(t("Todo {ref} not found.", { ref: todoRef(id) }));
  getDb().update(todos).set({ userNotes: JSON.stringify(todo.userNotes.filter((n) => n.at !== at)) }).where(eq(todos.id, id)).run();
  emitChange("todos");
  return getTodo(id)!;
}

/**
 * A worker or agent reports the todo done. It stays open (closing is yours) and is highlighted
 * until you close it; a later report replaces the earlier.
 */
export function markWorkerDone(id: number, by: string, note?: string | null): TodoView {
  const t = getTodo(id);
  if (!t) throw new NotFoundError(`Todo ${todoRef(id)} not found.`);
  // A worker's own todo needs no one to close it.
  if (t.byWorker) return setTodoStatus(id, "done", note?.trim() || `Erledigt von ${by}`);
  // Only a suggestion (a grey tick): ticking it off is yours.
  const v: NonNullable<TodoView["workerDone"]> = { at: new Date().toISOString(), by: by.slice(0, 100), note: note?.trim().slice(0, 500) || null, suggested: true };
  getDb().update(todos).set({ workerDone: JSON.stringify(v), updatedAt: v.at }).where(eq(todos.id, id)).run();
  emitChange("todos");
  return getTodo(id)!;
}

/**
 * The AI review thinks the todo is done: it only SUGGESTS it — the todo stays open, with a grey
 * tick to confirm (ticking it closes it). A worker's own todo needs no one, it closes.
 */
export function suggestDone(id: number, by: string, note?: string | null): TodoView {
  const t = getTodo(id);
  if (!t) throw new NotFoundError(`Todo ${todoRef(id)} not found.`);
  if (t.byWorker) return setTodoStatus(id, "done", note?.trim() || `Erledigt von ${by}`);
  getDb().update(todos).set({ workerDone: suggestedDoneJson(by, note) }).where(eq(todos.id, id)).run();
  emitChange("todos");
  return getTodo(id)!;
}

/** Not done after all: the worker's or the AI's word on it taken back — the todo stays open, as it was. */
export function clearWorkerDone(id: number): void {
  getDb().update(todos).set({ workerDone: null }).where(eq(todos.id, id)).run();
  emitChange("todos");
}

/**
 * The actions the auto-actions proposed on it, not wanted: taken off without a trace — not proposed again till
 * the todo changes. Actions that aren't proposed (yours, a run's) stay.
 */
export function dropProposedOps(id: number): void {
  const t = getTodo(id);
  if (!t?.autoOpsWhy) return;
  getDb().update(todos).set({ ops: "[]", autoOpsWhy: null, actionsReviewedAt: new Date().toISOString() }).where(eq(todos.id, id)).run();
  emitChange("todos");
}

const suggestedDoneJson = (by: string, note?: string | null) =>
  JSON.stringify({ at: new Date().toISOString(), by: by.slice(0, 100), note: note?.trim().slice(0, 500) || null, suggested: true });

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
  if (!getTodo(id)) throw new NotFoundError(t("Todo {ref} not found.", { ref: todoRef(id) }));
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
export function reconcileTodos(result: BoardResult, runId: number): { added: number; kept: number; closed: number; merged: number } {
  emitChange("todos");
  const out = { added: 0, kept: 0, closed: 0, merged: 0 };
  const now = new Date().toISOString();
  const resolved: number[] = [];
  // (The Lage's own operations aren't taken: a todo's actions are the auto-actions step's.)
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
        const byWorker = tx.select({ byWorker: todos.byWorker }).from(todos).where(eq(todos.id, r.id)).get()?.byWorker;
        if (done && !byWorker) {
          // Done is only suggested (grey tick) — you confirm it; its plan goes on then.
          tx.update(todos).set({ workerDone: suggestedDoneJson("Ticket-Lage", `Done, per the briefing run: ${r.why}`), updatedAt: now, runId }).where(eq(todos.id, r.id)).run();
          open.delete(r.id);
          continue;
        }
        tx.update(todos)
          .set({ status: done ? "done" : "dismissed", note: `${done ? "Done, per the briefing run" : "Outdated, per the briefing run"}: ${r.why}`.slice(0, 500), doneAt: now, updatedAt: now, runId })
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
          const before = tx.select({ ops: todos.ops, kind: todos.kind, owner: todos.owner, refs: todos.refs }).from(todos).where(eq(todos.id, td.id)).get();
          const had = cleanOps(parse<unknown[]>(before?.ops ?? "[]", []), ticket);
          const delivery = had.some((o) => (DELIVERY_OP_TYPES as readonly string[]).includes(o.type));
          const keep = delivery ? { ops: before!.ops, kind: before!.kind, owner: before!.owner } : { ops: before?.ops ?? "[]" };
          // Its plan: the new one, else the one it has.
          // What it cites is added to its context — what's there stays until you dismiss it.
          const refs = JSON.stringify([...new Set([...parse<string[]>(before?.refs ?? "[]", []), ...(JSON.parse(values.refs) as string[])])].slice(-40));
          tx.update(todos).set({ ...values, refs, ...keep, ...(plan.length ? { planned: JSON.stringify(plan) } : {}) }).where(eq(todos.id, td.id)).run();
          open.delete(td.id);
          out.kept++;
        } else {
          // Already open (here or on another ticket - the same message, the same numbers, the same
          // words): not made twice; the oldest of them takes this one in (the gate), its history says the run.
          const g = gateTodo(
            { ticket, text: values.text, kind: values.kind, owner: values.owner as "me" | "other", refs: JSON.parse(values.refs) as string[], due: dueDay(td.due), planned: plan, runId, byWorker: false, source: `Ticket-Lage #${runId}${values.source ? ` (${values.source})` : ""}` },
            { closed: true, anyTicket: true },
          );
          if (g) {
            if (g.outcome === "merged") out.merged++;
            out.kept++; // already there (merged into it) or dealt with lately: not made again
            continue;
          }
          tx.insert(todos).values({ ticket, ...values, planned: JSON.stringify(plan) }).run();
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
    .set({ status: "done", note: "Ticket done in Jira.", doneAt: now, updatedAt: now })
    .where(and(eq(todos.status, "open"), inArray(todos.ticket, tickets)))
    .returning()
    .all().length;
}

/** The actions that are an appointment: one in Outlook, in Google Calendar, in Zeff's own calendar. */
const APPOINTMENT_OPS = ["calendar-event", "gcal-event", "calendar-entry"];

/**
 * An appointment a todo proposes, moved (dragged in the calendar): its action gets the new start
 * ("YYYY-MM-DDTHH:MM") and length — nothing else on the todo changes, it stays the AI's suggestion.
 */
export function moveCalendarOp(todoId: number, index: number, start: string, minutes: number): TodoView {
  const todo = getTodo(todoId);
  if (!todo) throw new NotFoundError(t("Todo {ref} not found.", { ref: todoRef(todoId) }));
  if (todo.status !== "open") throw new ValidationError(t("{ref} isn't open any more.", { ref: todo.ref }));
  const op = todo.ops[index];
  if (!op || !APPOINTMENT_OPS.includes(op.type)) throw new ValidationError(t("That isn't an appointment."));
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start) || Number.isNaN(Date.parse(`${start}:00`))) throw new ValidationError(t("That isn't a time (YYYY-MM-DDTHH:MM)."));
  const length = Math.round(Number(minutes));
  if (!(length >= 5 && length <= 1440)) throw new ValidationError(t("The length: 5 to 1440 minutes."));
  const ops = todo.ops.map((o, i) => (i === index ? { ...o, start, minutes: length } : o));
  getDb().update(todos).set({ ops: JSON.stringify(ops), updatedAt: new Date().toISOString() }).where(eq(todos.id, todoId)).run();
  emitChange("todos");
  return getTodo(todoId)!;
}
