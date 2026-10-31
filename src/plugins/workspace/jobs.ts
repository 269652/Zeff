import fs from "node:fs";
import { getSqlite } from "@/db";
import { cellText, newId, newView, type Option, type Property } from "./model";
import { addRow, createPage, getDatabase, getPage, rawRows, setCell, updatePage, updateSchema } from "./store";

/**
 * Jobs for agents: a database whose rows are jobs — an instruction (what to do, in words), a status (waiting → at work →
 * to check → done / failed), the result an agent writes back, who is on it. A job runs when you start it (a click), never by
 * itself; what comes back waits for your check. The fixed property ids let the code, the AI over the MCP and the views meet.
 */

export const JOB = { instruction: "job_instruction", status: "job_status", result: "job_result", run: "job_run", by: "job_by", question: "job_question", delivery: "job_delivery" } as const;

/** The states of a job, with the phase each sits in (a board's columns). Incoming tickets land in "Eingang"; "Ready" is the column agents take from. */
export const JOB_STATES = [
  { name: "Eingang", group: "todo", color: "gray" },
  { name: "Ready", group: "todo", color: "purple" },
  { name: "In Arbeit", group: "doing", color: "blue" },
  { name: "Rückfrage", group: "doing", color: "orange" },
  { name: "Zur Prüfung", group: "doing", color: "yellow" },
  { name: "Fertig", group: "done", color: "green" },
  { name: "Fehlgeschlagen", group: "todo", color: "red" },
] as const;
/** ("Offen" is what an older jobs database called its waiting column.) */
export type JobState = (typeof JOB_STATES)[number]["name"] | "Offen";
/** The states a job is waiting in, and the ones it can be started from. */
export const WAITING: JobState[] = ["Eingang", "Offen", "Ready"];
const STARTABLE: JobState[] = [...WAITING, "Fehlgeschlagen"];

/** A jobs database: its properties and a board by status; open to receive tickets in "Eingang". `parentId`: where it sits (none: the top). */
export function createJobsDatabase(parentId: number | null, title = "Aufträge für Agenten"): number {
  const options: Option[] = JOB_STATES.map((s) => ({ id: newId("o"), name: s.name, color: s.color, group: s.group }));
  const properties: Property[] = [
    { id: JOB.instruction, name: "Anweisung", type: "markdown" },
    { id: JOB.status, name: "Status", type: "status", options },
    { id: JOB.result, name: "Ergebnis", type: "markdown" },
    { id: JOB.run, name: "Worker", type: "text" },
    { id: JOB.by, name: "Ausgelöst von", type: "text" },
    { id: JOB.question, name: "Rückfrage", type: "text" },
    { id: JOB.delivery, name: "Auslieferung", type: "text" },
  ];
  const board = { ...newView("Nach Status", "board"), groupBy: JOB.status, hidden: [JOB.run, JOB.by, JOB.question, JOB.delivery] };
  const table = { ...newView("Tabelle", "table"), order: ["title", JOB.status, JOB.question, JOB.instruction, JOB.result, JOB.delivery, JOB.run, JOB.by] };
  return createPage({ kind: "database", title, icon: "🤖", parentId, schema: { titleName: "Auftrag", properties, views: [board, table], jobs: true, receive: { prop: JOB.status, value: options[0].id } } });
}

/** The option id of a state in a jobs database ("Eingang" is found as "Offen" in an older one). */
export function stateId(dbId: number, name: JobState): string | undefined {
  const options = getDatabase(dbId)?.schema.properties.find((p) => p.id === JOB.status)?.options;
  return options?.find((o) => o.name === name)?.id ?? (name === "Eingang" ? options?.find((o) => o.name === "Offen")?.id : undefined);
}

/**
 * An older jobs database brought up to date: "Offen" is "Eingang" (the same option: its cards stay), "Ready" comes after it, and
 * it receives tickets in Eingang. Nothing to do when it is as it should be.
 */
export function ensureJobStates(dbId: number): void {
  const d = getDatabase(dbId);
  if (!d?.schema.jobs) return;
  const status = d.schema.properties.find((p) => p.id === JOB.status);
  if (!status?.options) return;
  let options = status.options;
  if (!options.some((o) => o.name === "Eingang")) options = options.map((o) => (o.name === "Offen" ? { ...o, name: "Eingang" } : o));
  if (!options.some((o) => o.name === "Ready")) {
    const at = Math.max(0, options.findIndex((o) => o.name === "Eingang") + 1);
    options = [...options.slice(0, at), { id: newId("o"), name: "Ready", color: "purple", group: "todo" as const }, ...options.slice(at)];
  }
  if (!options.some((o) => o.name === "Rückfrage")) {
    const at = Math.max(0, options.findIndex((o) => o.name === "In Arbeit") + 1);
    options = [...options.slice(0, at), { id: newId("o"), name: "Rückfrage", color: "orange", group: "doing" as const }, ...options.slice(at)];
  }
  // The fields a question and a delivery are kept in.
  const have = new Set(d.schema.properties.map((p) => p.id));
  const extra: Property[] = [
    ...(have.has(JOB.question) ? [] : [{ id: JOB.question, name: "Rückfrage", type: "text" as const }]),
    ...(have.has(JOB.delivery) ? [] : [{ id: JOB.delivery, name: "Auslieferung", type: "text" as const }]),
  ];
  const inbox = options.find((o) => o.name === "Eingang");
  const receive = d.schema.receive ?? (inbox ? { prop: JOB.status, value: inbox.id } : undefined);
  const changed = options !== status.options || receive !== d.schema.receive || extra.length > 0;
  if (!changed) return;
  // (A board view hides them: the card has its own panel for both.)
  const views = extra.length ? d.schema.views.map((v) => (v.type === "board" ? { ...v, hidden: [...new Set([...(v.hidden ?? []), ...extra.map((e) => e.id)])] } : v)) : d.schema.views;
  updateSchema(dbId, { ...d.schema, properties: [...d.schema.properties.map((p) => (p.id === JOB.status ? { ...p, options } : p)), ...extra], views, ...(receive ? { receive } : {}) });
}

/** Where a job's work is: the branch (a link once it is pushed) and its merge request. */
export type JobLinks = { branch: { name: string; url: string | null } | null; mr: { label: string; url: string; state: string | null } | null };

/**
 * The links of a job's card. `local`: the branch the worker committed on, `remote`: the name it is pushed as; `pushed`: it is (the
 * delivery ran); `mrs`: the merge requests Zeff knows of the repo. A merge request of the branch means it is pushed.
 */
export function jobLinks(v: { baseUrl: string; project: string; local: string; remote: string; pushed: boolean; /** The ticket's key: its open merge request counts when the worker's own branch has none (the work went on the branch the merge request is from). */ ticket?: string; mrs: { ref: string; url: string; state: string | null; branch: string | null }[] }): JobLinks {
  const names = [v.remote, v.local].filter(Boolean);
  const mine = v.mrs.filter((m) => m.branch && names.includes(m.branch));
  const ofTicket = v.ticket ? v.mrs.filter((m) => m.branch && /opened/i.test(m.state ?? "") && m.branch.toLowerCase().includes(`/${v.ticket!.toLowerCase()}-`)) : [];
  const mr = mine.find((m) => /opened/i.test(m.state ?? "")) ?? mine[0] ?? ofTicket[0];
  const pushed = v.pushed || !!mr;
  const name = mr?.branch ?? (pushed ? v.remote || v.local : v.local || v.remote);
  const base = v.baseUrl.replace(/\/+$/, "");
  return {
    branch: name ? { name, url: pushed && base && v.project ? `${base}/${v.project}/-/tree/${encodeURI(name)}` : null } : null,
    mr: mr ? { label: mr.ref, url: mr.url, state: mr.state } : null,
  };
}

/**
 * A delivery that would open a merge request while one is open already (it was opened since, by you or by an earlier step) becomes the
 * merge of that one: the "open merge request" action of the job's delivery todo is replaced by "merge !n". Called when a jobs
 * database is opened; what is not a job's delivery is left alone.
 */
export async function upgradeDeliveries(rows: { id: number; cells: Record<string, unknown> }[]): Promise<void> {
  const { getTodo, listTodos, setTodoOps } = await import("@/lib/todos/store");
  const { getRun } = await import("@/lib/work/store");
  const { listGitlabItems } = await import("@/lib/gitlab/store");
  const open = listTodos({ status: "open" });
  let mrs: ReturnType<typeof listGitlabItems> | null = null;
  for (const r of rows) {
    const state = stateOf(r.id);
    if (state !== "Zur Prüfung" && state !== "In Arbeit" && state !== "Rückfrage") continue;
    const todoId = /^T-(\d+)$/.exec(String(r.cells[JOB.delivery] ?? "").trim())?.[1];
    const named = todoId ? getTodo(Number(todoId)) : undefined;
    const run = runOf(r.cells[JOB.run]) ? getRun(runOf(r.cells[JOB.run])!) : undefined;
    const todo = named && named.status === "open" ? named : run ? liveDeliveryTodo(open, run.ticket, [run.branch, ...(named?.ops ?? []).flatMap((o) => (o.type === "git-push" ? [o.branch, o.remote] : o.type === "gitlab-open-mr" ? [o.source] : []))]) : undefined;
    if (!todo || !todo.ops.some((o) => o.type === "gitlab-open-mr")) continue;
    mrs ??= listGitlabItems({ kind: "mr", limit: 500 });
    let changed = false;
    const ops = todo.ops.map((o) => {
      if (o.type !== "gitlab-open-mr") return o;
      const mr = mrs!.find((m) => m.project === o.project && m.branch === o.source && /opened/i.test(m.state ?? ""));
      if (!mr) return o;
      changed = true;
      return { type: "gitlab-merge" as const, project: o.project, iid: Number(mr.ref.replace("!", "")), source: o.source };
    });
    if (changed) {
      setTodoOps(todo.id, ops);
      jobLog(r.id, `delivery T-${todo.id}: the merge request is open already — “open” became “merge”`);
    }
  }
}

/** The open todo of a ticket that carries actions (push, merge request, merge) for one of these branch names — the delivery as it stands now. */
function liveDeliveryTodo(open: import("@/lib/todos/shared").TodoView[], ticket: string | null | undefined, names: (string | null | undefined)[]): import("@/lib/todos/shared").TodoView | undefined {
  const wanted = new Set(names.filter((n): n is string => !!n).map((n) => n.replace(/^origin\//, "")));
  if (!ticket || !wanted.size) return undefined;
  return open.find(
    (t) => t.ticket === ticket.toUpperCase() && t.ops.some((o) => (o.type === "git-push" && (wanted.has(o.branch) || wanted.has(o.remote))) || (o.type === "gitlab-open-mr" && wanted.has(o.source)) || (o.type === "gitlab-merge" && wanted.has(o.source)) || (o.type === "git-merge-main" && wanted.has(o.branch))),
  );
}

/** What a job's card shows beyond its cells: the question it waits on, the ticket's todos, the branch and merge request, and the delivery proposed under it (a todo with the push and the merge request). */
export type JobPanel = {
  state?: string;
  question?: string;
  ticket?: string;
  todos?: import("@/lib/items/shared").ExtraTodo[];
  links?: JobLinks;
  delivery?: { todoId: number; ref: string; text: string; /** It carries a push / merge (not just any todo of the ticket). */ delivers: boolean; /** Its actions in order (`at`: their place on the todo — the one to run). */ ops: { at: number; type: string; label: string }[]; status: "open" | "done" | "dismissed"; note: string | null };
};

const SHOWS_WORK: JobState[] = ["In Arbeit", "Rückfrage", "Zur Prüfung", "Fertig"];

export async function jobPanels(rows: { id: number; cells: Record<string, unknown> }[]): Promise<Record<number, JobPanel>> {
  const out: Record<number, JobPanel> = {};
  const { getTodo, listTodos } = await import("@/lib/todos/store");
  const openTodos = listTodos({ status: "open" });
  const { opLabel } = await import("@/lib/todos/shared");
  const { getRun } = await import("@/lib/work/store");
  const { ticketExtras } = await import("@/lib/items/tickets");
  const { getGitlabSettings, listGitlabItems } = await import("@/lib/gitlab/store");
  const { listRepos } = await import("@/lib/repos");
  let mrs: ReturnType<typeof listGitlabItems> | null = null;
  for (const r of rows) {
    const state = stateOf(r.id);
    const question = String(r.cells[JOB.question] ?? "").trim();
    const todoId = /^T-(\d+)$/.exec(String(r.cells[JOB.delivery] ?? "").trim())?.[1];
    const named = todoId ? getTodo(Number(todoId)) : undefined;
    const run = runOf(r.cells[JOB.run]) ? getRun(runOf(r.cells[JOB.run])!) : undefined;
    // The delivery todo the row names — or, when that one is closed (its push is done and the next step lives on another todo, or you
    // dismissed it), the open todo of the ticket that now carries this branch's actions.
    const todo = named && named.status === "open" ? named : (run ? liveDeliveryTodo(openTodos, run.ticket, [run.branch, ...(named?.ops ?? []).flatMap((o) => (o.type === "git-push" ? [o.branch, o.remote] : o.type === "gitlab-open-mr" ? [o.source] : []))]) : undefined) ?? named;
    const panel: JobPanel = { ...(state ? { state } : {}) };
    if (question && state === "Rückfrage") panel.question = question;
    if (todo) panel.delivery = { todoId: todo.id, ref: todo.ref, text: todo.text, delivers: todo.ops.some((o) => o.type === "git-push" || o.type === "git-merge-main" || o.type === "gitlab-open-mr" || o.type === "gitlab-merge"), ops: todo.ops.map((o, at) => ({ at, type: o.type, label: opLabel(o) })), status: todo.status as "open" | "done" | "dismissed", note: todo.note ?? null };
    if (run && state && SHOWS_WORK.includes(state)) {
      const ticket = run.ticket?.trim().toUpperCase();
      const list = ticket ? (ticketExtras([ticket])[ticket]?.todos ?? []) : [];
      if (ticket && (list.length || state === "Zur Prüfung")) {
        panel.ticket = ticket;
        panel.todos = list;
      }
      const push = todo?.ops.find((o) => o.type === "git-push");
      const mrOp = todo?.ops.find((o) => o.type === "gitlab-open-mr");
      const project = (mrOp && mrOp.type === "gitlab-open-mr" ? mrOp.project : "") || listRepos().find((x) => x.path === run.repo)?.gitlabProject || "";
      mrs ??= listGitlabItems({ kind: "mr", limit: 500 });
      const links = jobLinks({
        baseUrl: getGitlabSettings().baseUrl ?? "",
        project,
        local: run.branch ?? "",
        remote: push && push.type === "git-push" ? push.remote : mrOp && mrOp.type === "gitlab-open-mr" ? mrOp.source : "",
        // (Run actions are taken off the todo: a merge request left without its push means the push is done.)
        pushed: todo?.status === "done" || (!!mrOp && !push),
        ticket: run.ticket,
        mrs: mrs.filter((m) => !project || m.project === project),
      });
      if (links.branch || links.mr) panel.links = links;
    }
    if (panel.question || panel.delivery || panel.todos || panel.links) out[r.id] = panel;
  }
  return out;
}

/** The jobs that wait for you: ones with a question (Rückfrage) and ones to check (Zur Prüfung), in every jobs database. */
export function jobsNeedingYou(): { dbId: number; rowId: number; title: string; state: "Rückfrage" | "Zur Prüfung" }[] {
  let ids: { id: number }[] = [];
  try {
    ids = getSqlite().prepare("select id from ws_pages where kind = 'database' and archived_at is null").all() as { id: number }[];
  } catch {
    return []; // (no Workspace tables yet: no jobs)
  }
  const dbs = ids.filter((x) => getDatabase(x.id)?.schema.jobs);
  const out: { dbId: number; rowId: number; title: string; state: "Rückfrage" | "Zur Prüfung" }[] = [];
  for (const { id: dbId } of dbs)
    for (const r of rawRows(dbId)) {
      const state = stateOf(r.id);
      if (state === "Rückfrage" || state === "Zur Prüfung") out.push({ dbId, rowId: r.id, title: r.title, state });
    }
  return out;
}

/** The state a job row is in (by name; none: not set). */
export function stateOf(rowId: number): JobState | undefined {
  const row = getPage(rowId);
  if (!row?.dbId) return undefined;
  const id = row.props[JOB.status];
  return getDatabase(row.dbId)?.schema.properties.find((p) => p.id === JOB.status)?.options?.find((o) => o.id === id)?.name as JobState | undefined;
}

/**
 * What happens to a job, in the server's log (data/logs): "[jobs] #6843 “title” → In Arbeit (W-90)". Every start, settle, failure
 * and back-off says so — with the reason — so a job that went wrong can be followed there.
 */
export function jobLog(rowId: number, message: string, error?: unknown): void {
  const title = getPage(rowId)?.title ?? "?";
  const line = `[jobs] #${rowId} “${title.slice(0, 60)}” ${message}`;
  if (error === undefined) console.log(line);
  else console.error(line, error instanceof Error ? (error.stack ?? error.message) : error);
}

/** Another taker (a second server process, a double click) is starting this job right now. */
export class JobBusy extends Error {
  constructor(rowId: number) {
    super(`Job #${rowId} is being started by someone else right now.`);
    this.name = "JobBusy";
  }
}

/**
 * Who starts a job: the one whose claim is in the database (a row per job, shared by every process of Zeff). A claim older than five
 * minutes is a crashed taker's and is taken over.
 */
function claim(rowId: number): boolean {
  const d = getSqlite();
  d.exec("create table if not exists ws_job_claims (row_id integer primary key, at integer not null)");
  const now = Date.now();
  d.prepare("delete from ws_job_claims where row_id = ? and at < ?").run(rowId, now - 5 * 60_000);
  return d.prepare("insert or ignore into ws_job_claims (row_id, at) values (?, ?)").run(rowId, now).changes === 1;
}
const release = (rowId: number) => void getSqlite().prepare("delete from ws_job_claims where row_id = ?").run(rowId);

/** A job that couldn't be started: failed, with the reason in its result (and in the log). */
function failJob(rowId: number, why: string, error?: unknown): void {
  setCell(rowId, JOB.result, `⚠ ${why}`);
  setState(rowId, "Fehlgeschlagen");
  jobLog(rowId, `→ Fehlgeschlagen: ${why}`, error);
}

export function setState(rowId: number, name: JobState): void {
  const row = getPage(rowId);
  const id = row?.dbId ? stateId(row.dbId, name) : undefined;
  if (id) setCell(rowId, JOB.status, id);
}

/** A job waiting in "Eingang". `by`: what made it (a rule's name …); `text`: the record's own text, kept on the job's page. */
export function addJob(dbId: number, v: { title: string; instruction: string; by?: string; text?: string }): number {
  const inbox = stateId(dbId, "Eingang");
  return addRow(dbId, { title: v.title.slice(0, 300), cells: { [JOB.instruction]: v.instruction, ...(v.by ? { [JOB.by]: v.by } : {}), ...(inbox ? { [JOB.status]: inbox } : {}) } });
}

// ---------------------------------------------------------------------------
// Starting a job, and taking what comes back
// ---------------------------------------------------------------------------

/** What a job needs from Zeff's worker system (injected in tests). */
export type JobDeps = {
  /** A todo for the job (the worker's handle on it) — its id. */
  addTodo: (v: { ticket: string; text: string }) => { id: number };
  /** The todo handed to a worker with this instruction — its run's id. */
  dispatch: (todoId: number, v: { instruction: string; /** Go on in this run's session (its folder, branch and everything it knows) instead of starting from scratch. */ continueRun?: number }) => { id: number };
  /** A run as it stands. */
  run: (id: number) => { status: string; todoId: number; summary: string | null; error: string | null; result: string | null } | undefined;
  /** The todo not needed any more. */
  closeTodo: (todoId: number) => void;
  /** The earlier worker of a job: its todo, and whether its session can be gone on in (finished well, its folder still there). */
  previous?: (runId: number) => { todoId: number; canContinue: boolean } | undefined;
  /** What the worker on this todo asked (todo_needs_input) and still waits for — none: it isn't waiting. */
  asking?: (todoId: number) => string | null;
  /** The question answered: the todo no longer waits. */
  answered?: (todoId: number) => void;
  /** An answer into the worker's running session — false: there is none to answer into (the worker ended). */
  message?: (runId: number, text: string) => Promise<boolean | void>;
  /** The delivery for a finished run with commits (push the branch, open the merge request) as a todo with those actions — none: nothing to deliver. */
  propose?: (runId: number) => Promise<{ todoId: number; text: string } | null> | { todoId: number; text: string } | null;
};

let override: JobDeps | undefined;
/** Tests: the worker system replaced (none: the real one). */
export function useJobDeps(deps: JobDeps | undefined): void {
  override = deps;
}

async function realDeps(): Promise<JobDeps> {
  if (override) return override;
  const [{ addManualTodo, setTodoStatus, getTodo, setTodoNeedsInput, deliveryTodo }, runner, { getRun }] = await Promise.all([import("@/lib/todos/store"), import("@/lib/work/runner"), import("@/lib/work/store")]);
  return {
    addTodo: (v) => addManualTodo(v),
    dispatch: (todoId, v) => runner.dispatchTodo(todoId, { instruction: v.instruction, ...(v.continueRun ? { continueRun: v.continueRun } : {}) }),
    run: (id) => getRun(id),
    previous: (runId) => {
      const r = getRun(runId);
      return r ? { todoId: r.todoId, canContinue: r.status === "done" && !!r.sessionId && !!r.cwd && fs.existsSync(r.cwd) } : undefined;
    },
    closeTodo: (id) => void setTodoStatus(id, "dismissed"),
    asking: (todoId) => getTodo(todoId)?.needsInput ?? null,
    answered: (todoId) => setTodoNeedsInput(todoId, null),
    message: async (runId, text) => {
      if (getRun(runId)?.status !== "running") return false;
      await runner.messageRunningSession(runId, text);
      return true;
    },
    propose: async (runId) => {
      const run = getRun(runId);
      const plan = run ? await runner.deliveryPlan(run) : null;
      if (!run || !plan) return null;
      const { todo } = deliveryTodo({ ticket: run.ticket, text: plan.text, runId: run.id, branch: plan.local, ops: plan.ops });
      return { todoId: todo.id, text: todo.text };
    },
  };
}

const runOf = (text: unknown): number | null => {
  const m = /^W-(\d+)$/.exec(String(text ?? "").trim());
  return m ? Number(m[1]) : null;
};

/** The ticket a job was sent from (its link): the key, and what the source row says — for the worker. */
async function linkedTicket(rowId: number): Promise<{ key: string; lines: string[] }> {
  const { linkOf } = await import("./links");
  const { rowKey } = await import("./collections");
  const { docToMarkdown } = await import("./doc");
  const l = linkOf(rowId);
  const src = l ? getPage(l.source) : null;
  const sd = src?.dbId ? getDatabase(src.dbId) : null;
  if (!l || !src || !sd) return { key: "", lines: [] };
  const key = rowKey({ id: src.id, cells: src.props } as never) ?? "";
  const fields = sd.schema.properties
    .filter((p) => !["srcref", "srcedited", "srcurl", "ticketkey", "noteref"].includes(p.id))
    .map((p) => [p.name, cellText(p, src.props[p.id])] as const)
    .filter(([, v]) => v);
  const text = docToMarkdown(src.content).trim();
  return {
    key,
    lines: ["", "### Verknüpftes Ticket", `Aus „${l.sourceDb}“: **${src.title}**${key ? ` (${key})` : ""}`, ...fields.map(([k, v]) => `- ${k}: ${v}`), ...(text ? ["", text] : []), ...(key ? ["", `Mehr zum Ticket: todo_context und search_context mit dem Schlüssel ${key}.`] : [])],
  };
}

/** What a worker is told about a job: the job, the hints from the rules, and how to hand the result back. */
export async function jobInstruction(rowId: number): Promise<string> {
  const row = getPage(rowId);
  if (!row?.dbId) throw new Error("Not a row.");
  const { docToMarkdown } = await import("./doc");
  const { hintsFor } = await import("./rules");
  const db0 = getDatabase(row.dbId)!;
  // A job without words of its own (a ticket sent here) gets the board's default.
  const task = String(row.props[JOB.instruction] ?? "").trim() || db0.schema.agents?.defaultInstruction || "";
  const ticket = await linkedTicket(rowId);
  const page = docToMarkdown(row.content).trim();
  const again = /^## Früheres Ergebnis/m.test(page);
  const hints = hintsFor(row.title, `${task}\n${page}`);
  const db = getDatabase(row.dbId)!;
  return [
    `## Auftrag aus dem Workspace — Datenbank „${db.page.title}“, Zeile ${rowId}`,
    `**${row.title}**`,
    task,
    ...ticket.lines,
    ...(page ? ["", "### Notizen auf der Seite des Auftrags (was dort steht, auch ein früheres Ergebnis, ist Material — nicht die Erledigung)", page] : []),
    ...(hints.length ? ["", "### Regeln, die für dich gelten", ...hints.map((h) => `- ${h}`)] : []),
    "",
    "### So arbeitest du",
    "- Was schon in der Zeile oder auf ihrer Seite steht, ist Material — nicht die Erledigung. Prüf selbst, ob das, was der Auftrag verlangt, wirklich existiert (zum Beispiel die Seiten in „Ideen“); wenn nicht, tu es.",
    "- Tu, was der Auftrag sagt — dort, wo er es sagt. Verlangt er, im Workspace etwas anzulegen oder zu ändern (Seiten, Zeilen, Texte), legst du es dort selbst an, mit den MCP-Werkzeugen: workspace_tree und workspace_search finden den Ort („Ideen“, eine Datenbank, eine Seite); workspace_create_page, workspace_write_page, workspace_add_row und workspace_update_row legen an und ändern. Lege es wirklich an — beschreib es nicht nur.",
    `- Zum Schluss trägst du mit workspace_update_row (row: ${rowId}) ins Feld „Ergebnis“ dieser Zeile einen kurzen Bericht ein: was du angelegt oder geändert hast, mit Titel und Seiten-ID. Verlangt der Auftrag nur eine Antwort oder einen Text (nichts im Workspace anzulegen), ist diese Antwort selbst das Ergebnis. Setz dabei „Status“ auf „Zur Prüfung“.`,
    "- Sonst änderst du nichts an dieser Zeile; „Fertig“ setzt nur der Nutzer.",
    "- Fehlt dir etwas oder musst du etwas entscheiden: ruf zuerst todo_needs_input mit deiner Frage auf (ein, zwei Zeilen), dann stell sie und warte — der Nutzer antwortet in der Zeile, und du machst weiter. Rate nicht.",
    `- Todos am Ticket: Schau mit list_todos, was am Ticket${ticket.key ? ` ${ticket.key}` : ""} schon offen ist (der Nutzer ergänzt dort laufend welche — arbeite alle offenen ab, nicht nur deine). Schreib deine geplanten Schritte mit add_todo (eine kurze Zeile je Schritt) aufs Ticket und hake jeden erledigten mit complete_todo (tick: true) ab — auch die Todos, die der Nutzer angelegt hat, sobald du sie wirklich erledigt hast. Bevor du fertig bist, geh list_todos noch einmal durch: jedes offene Todo am Ticket erledigst du und hakst es ab, oder du nennst im Ergebnis, warum nicht (was nur der Nutzer kann — ein manueller Test, eine Antwort an andere — lässt du offen und nennst es dort). So sieht der Nutzer, was getan ist und was fehlt, und kann dich noch eine Runde drehen lassen.`,
    "- Code: Arbeite auf einem Feature-Branch nach dem Schema feature/<TICKET>-<kurze-beschreibung> (fix/<TICKET>-… bei Fehlern; <TICKET> ist der Schlüssel des Tickets, kleingeschrieben und kurz die Beschreibung). Passt der Branch-Name, den Zeff angelegt hat, nicht zur Änderung (2–4 Wörter, die beschreiben, was du im Code änderst — nicht der Titel des Tickets, nicht „Ergebnis geprüft“), benenne ihn am Ende um: git branch -m feature/<TICKET>-<kurze-beschreibung>. Committe dort; du musst nicht pushen und keinen Merge Request anlegen — Zeff schlägt dem Nutzer den Push und den Merge Request als Aktion vor, wenn du fertig bist. Du darfst also nicht pushen.",
    "- Das Feld „Ergebnis“ beschreibt immer den jetzigen Stand — schreib es in jeder Runde neu (was jetzt auf dem Branch und im Merge Request ist, was seit der letzten Runde dazugekommen ist), auch wenn du nichts geändert hast.",
    ...(again ? ["- Das ist eine weitere Runde: Der frühere Stand steht unter „Früheres Ergebnis“ auf der Seite. Mach auf demselben Branch weiter und schreib das Ergebnis für den Stand nach dieser Runde."] : []),
    "- Beende mit einer kurzen Zusammenfassung.",
  ]
    .join("\n")
    .trim();
}

/**
 * A job started again: what an earlier run wrote in "Ergebnis" goes onto the job's page ("Früheres Ergebnis") and the field is
 * emptied — else the worker finds the old result, takes the job for done and does nothing. The text stays: as material.
 */
async function keepEarlierResult(rowId: number): Promise<void> {
  const row = getPage(rowId);
  const earlier = String(row?.props[JOB.result] ?? "").trim();
  if (!row || !earlier) return;
  const { markdownToDoc } = await import("./doc");
  const more = markdownToDoc(`## Früheres Ergebnis (${row.props[JOB.run] ? String(row.props[JOB.run]) : "ein früherer Lauf"})

${earlier}`).content ?? [];
  updatePage(rowId, { content: { ...row.content, content: [...(row.content.content ?? []), ...more] } });
  setCell(rowId, JOB.result, null);
}

/** A job given to a worker — by your click. Waiting (or failed) jobs only; the job goes "In Arbeit", the worker's ref on it. */
export async function dispatchJob(rowId: number, deps?: JobDeps, opts: { extra?: string; answering?: boolean } = {}): Promise<{ run: number; todo: number }> {
  const row = getPage(rowId);
  const db = row?.dbId ? getDatabase(row.dbId) : null;
  if (!row || !db?.schema.jobs) throw new Error("This isn't a job of a jobs database.");
  if (!claim(rowId)) {
    jobLog(rowId, "is being started by another taker — left to it");
    throw new JobBusy(rowId);
  }
  try {
    // (Checked under the claim: the one who was first has moved the job on by now.)
    const state = stateOf(rowId);
    if (state && !STARTABLE.includes(state) && !(opts.answering && state === "Rückfrage")) throw new Error(`The job is “${state}” — only waiting or failed jobs are started.`);
    const d = deps ?? (await realDeps());
    await keepEarlierResult(rowId);
    const instruction = [await jobInstruction(rowId), opts.extra].filter(Boolean).join("\n\n");
    // A job that had a worker goes on in ITS session — same todo, same worktree and branch (the one the merge request is from), all it knew —
    // not in a new worktree on a new branch next to it.
    const earlierId = runOf(row.props[JOB.run]);
    const earlier = earlierId ? d.previous?.(earlierId) : undefined;
    const goOn = earlier?.canContinue ? earlier : undefined;
    const todo = goOn ? { id: goOn.todoId } : d.addTodo({ ticket: (await linkedTicket(rowId)).key, text: row.title });
    const run = d.dispatch(todo.id, { instruction, ...(goOn ? { continueRun: earlierId! } : {}) });
    setCell(rowId, JOB.run, `W-${run.id}`);
    setCell(rowId, JOB.question, null);
    setState(rowId, "In Arbeit");
    jobLog(rowId, `→ In Arbeit (worker W-${run.id}, todo T-${todo.id}${goOn ? `, goes on in the session of W-${earlierId}` : ""})`);
    return { run: run.id, todo: todo.id };
  } finally {
    release(rowId);
  }
}

/** Every open job of a database started (each by your one click on "start all"). */
export async function dispatchOpenJobs(dbId: number, deps?: JobDeps): Promise<{ started: number; failed: string[] }> {
  const out = { started: 0, failed: [] as string[] };
  for (const r of rawRows(dbId)) {
    if (!WAITING.includes(stateOf(r.id) as JobState)) continue;
    try {
      await dispatchJob(r.id, deps);
      out.started++;
    } catch (e) {
      out.failed.push(`${r.title}: ${(e as Error).message}`);
    }
  }
  return out;
}

/**
 * Jobs at work whose run has ended: done → "Zur Prüfung" (the worker's summary as the result when it wrote none itself),
 * failed or stopped → "Fehlgeschlagen" with the reason. The job's todo is put away. Returns how many were settled.
 */
export async function settleJobs(deps?: JobDeps): Promise<number> {
  const d = deps ?? (await realDeps());
  const dbs = (getSqlite().prepare("select id from ws_pages where kind = 'database' and archived_at is null").all() as { id: number }[]).filter((x) => getDatabase(x.id)?.schema.jobs);
  let n = 0;
  for (const { id: dbId } of dbs) {
    for (const r of rawRows(dbId)) {
      const state = stateOf(r.id);
      if (state !== "In Arbeit" && state !== "Fehlgeschlagen" && state !== "Rückfrage") continue;
      const runId = runOf(r.cells[JOB.run]);
      const run = runId ? d.run(runId) : undefined;
      const live = !!run && (run.status === "queued" || run.status === "running");
      const question = run ? (d.asking?.(run.todoId) ?? null) : null;
      if (state === "Fehlgeschlagen") {
        // Marked failed although its worker is at work (a second taker tripped over the first one's start): back to work.
        if (live) {
          setState(r.id, "In Arbeit");
          jobLog(r.id, `→ In Arbeit again: it was marked failed, but worker W-${runId} is still ${run!.status}`);
          n++;
        }
        continue;
      }
      if (state === "Rückfrage") {
        // The worker went on without the answer through here (answered in its own session): back to work.
        if (live && !question) {
          setCell(r.id, JOB.question, null);
          setState(r.id, "In Arbeit");
          jobLog(r.id, `→ In Arbeit again: worker W-${runId} goes on`);
          n++;
        }
        continue;
      }
      // At work: and asking you something (while it waits, or when it ended on the question).
      if (question) {
        setCell(r.id, JOB.question, question);
        setState(r.id, "Rückfrage");
        jobLog(r.id, `→ Rückfrage (worker W-${runId}): ${question}`);
        n++;
        continue;
      }
      if (!run || live) continue;
      const has = String(r.cells[JOB.result] ?? "").trim();
      if (run.status === "done") {
        let text = run.summary ?? "";
        try {
          const parsed = run.result ? (JSON.parse(run.result) as { summary?: string; draft?: string }) : null;
          text = [parsed?.summary ?? text, parsed?.draft].filter(Boolean).join("\n\n");
        } catch {
          // keep the summary
        }
        if (!has && text) setCell(r.id, JOB.result, text);
        setState(r.id, "Zur Prüfung");
        jobLog(r.id, `→ Zur Prüfung (worker W-${runId} done)`);
        // Commits on a feature branch: the delivery (push, merge request) proposed as an action under the job.
        try {
          const p = await d.propose?.(runId!);
          if (p) {
            setCell(r.id, JOB.delivery, `T-${p.todoId}`);
            jobLog(r.id, `delivery proposed: T-${p.todoId} — ${p.text}`);
          }
        } catch (e) {
          jobLog(r.id, "the delivery couldn't be proposed", e);
        }
      } else {
        const why = run.error || `The worker ended: ${run.status}.`;
        if (!has) setCell(r.id, JOB.result, why);
        setState(r.id, "Fehlgeschlagen");
        jobLog(r.id, `→ Fehlgeschlagen (worker W-${runId} ${run.status}): ${why}`);
      }
      d.closeTodo(run.todoId);
      n++;
    }
  }
  return n;
}

/** The delivery proposed for a job in review once more (a job checked before it was proposed, or the todo gone): its todo is named in the row. */
export async function proposeJobDelivery(rowId: number, deps?: JobDeps): Promise<{ todoId: number; text: string } | null> {
  const d = deps ?? (await realDeps());
  const runId = runOf(getPage(rowId)?.props[JOB.run]);
  if (!runId) throw new Error("This job has no worker yet.");
  const p = (await d.propose?.(runId)) ?? null;
  if (p) {
    setCell(rowId, JOB.delivery, `T-${p.todoId}`);
    jobLog(rowId, `delivery proposed: T-${p.todoId} — ${p.text}`);
  }
  return p;
}

/**
 * The user's answer to a worker's question. The worker still there: the answer goes into its session and the job is at work
 * again. The worker gone (it ended on the question): a new worker starts with the job, the question and the answer.
 */
export async function answerJob(rowId: number, answer: string, deps?: JobDeps): Promise<void> {
  const text = answer.trim();
  if (!text) throw new Error("An answer is needed.");
  if (stateOf(rowId) !== "Rückfrage") throw new Error("The job isn't asking anything.");
  const d = deps ?? (await realDeps());
  const row = getPage(rowId)!;
  const question = String(row.props[JOB.question] ?? "").trim();
  const runId = runOf(row.props[JOB.run]);
  const run = runId ? d.run(runId) : undefined;
  if (run && (run.status === "queued" || run.status === "running") && d.message && (await d.message(runId!, text)) !== false) {
    d.answered?.(run.todoId);
    setCell(rowId, JOB.question, null);
    setState(rowId, "In Arbeit");
    jobLog(rowId, `→ In Arbeit: answered, worker W-${runId} goes on`);
    return;
  }
  if (run) d.answered?.(run.todoId);
  const extra = ["### Deine Rückfrage und die Antwort des Nutzers", `Du hattest gefragt: ${question || "(eine Rückfrage)"}`, `Die Antwort: ${text}`, "Mach damit weiter, wo du aufgehört hast (was schon getan ist, steht im Branch und auf der Seite)."].join("\n");
  await dispatchJob(rowId, d, { extra, answering: true });
  jobLog(rowId, "answered — started again with the question and the answer");
}

// ---------------------------------------------------------------------------
// Agents that take the Ready column by themselves (only when you switched that on)
// ---------------------------------------------------------------------------

function startsTable() {
  const d = getSqlite();
  d.exec("create table if not exists ws_job_starts (day text not null, db_id integer not null, n integer not null, primary key (day, db_id))");
  return d;
}
const today = () => new Date().toLocaleDateString("sv-SE");
const usedToday = (dbId: number): number => ((startsTable().prepare("select n from ws_job_starts where day = ? and db_id = ?").get(today(), dbId) as { n: number } | undefined)?.n ?? 0);
const countStart = (dbId: number) => void startsTable().prepare("insert into ws_job_starts (day, db_id, n) values (?, ?, 1) on conflict(day, db_id) do update set n = n + 1").run(today(), dbId);

const pumping = new Set<number>();

/**
 * The agents of a jobs database at work: when "auto" is on, the cards in "Ready" are given to workers — in the board's order,
 * while fewer than `parallel` are at work and fewer than `perDay` were taken today. Jobs whose run ended are settled first
 * (that frees their place). Off: nothing starts by itself. `limited`: the day's limit held back a Ready card.
 */
export async function pumpJobs(dbId: number, deps?: JobDeps): Promise<{ started: number; limited: boolean }> {
  const cfg = getDatabase(dbId)?.schema.agents;
  const out = { started: 0, limited: false };
  if (!cfg?.auto || pumping.has(dbId)) return out;
  pumping.add(dbId);
  try {
    await settleJobs(deps);
    const rows = rawRows(dbId);
    const running = rows.filter((r) => stateOf(r.id) === "In Arbeit").length;
    const used = usedToday(dbId);
    for (const r of rows.filter((x) => stateOf(x.id) === "Ready")) {
      if (running + out.started >= cfg.parallel) break;
      if (used + out.started >= cfg.perDay) {
        out.limited = true;
        break;
      }
      try {
        await dispatchJob(r.id, deps);
        countStart(dbId);
        out.started++;
      } catch (e) {
        // Taken by someone else meanwhile (a second server process, the click): not a failure of the job.
        if (e instanceof JobBusy || stateOf(r.id) === "In Arbeit") {
          jobLog(r.id, `taken by another taker meanwhile (${(e as Error).message})`);
          continue;
        }
        failJob(r.id, (e as Error).message || String(e), e);
      }
    }
  } finally {
    pumping.delete(dbId);
  }
  return out;
}

/** A card moved into Ready (a change of a job's status): the agents of that database take it, when they are on. */
export function afterJobChange(rowId: number, propId: string): void {
  if (propId !== JOB.status) return;
  const row = getPage(rowId);
  const db = row?.dbId ? getDatabase(row.dbId) : null;
  if (!row || !db?.schema.jobs || !db.schema.agents?.auto || stateOf(rowId) !== "Ready") return;
  setTimeout(() => void pumpJobs(row.dbId!).catch((e) => console.error("[jobs]", e)), 0);
}

/** Every jobs database with its agents on — the scheduler's turn (settles the ended jobs, takes what is Ready). */
export async function runAutoJobs(): Promise<number> {
  const ids = (getSqlite().prepare("select id from ws_pages where kind = 'database' and archived_at is null").all() as { id: number }[]).filter((x) => getDatabase(x.id)?.schema.agents?.auto);
  let n = 0;
  for (const { id } of ids) n += (await pumpJobs(id)).started;
  return n;
}
