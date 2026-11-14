import { getSqlite } from "@/db";
import { emitChange } from "@/lib/events";
import { createPage, getPage, inTemplates } from "../store";
import { normalizeFlow, type FlowDef } from "./types";
import { keepPartVersion } from "../part-versions";

/**
 * Where flows live: each is a page of the Workspace (its title, its place in the tree — an app's flows under the app) with its
 * definition; its runs with their journal (what every node gave, so a run that waited goes on where it stopped) and their log;
 * the secrets flows use (API keys), which never leave the server: a run's log shows them as •••. Server only.
 */

function db() {
  const d = getSqlite();
  d.exec(`
    create table if not exists ws_flows (page_id integer primary key, name text not null unique, def text not null, enabled integer not null default 1, last_run_at text, next_run_at text);
    create table if not exists ws_flow_runs (id integer primary key autoincrement, page_id integer not null, name text not null, trigger text not null, status text not null, input text not null default '{}', output text, error text, def text not null, journal text not null default '{}', log text not null default '[]', waiting text, wake_at text, dry integer not null default 0, started_at text not null, ended_at text);
    create index if not exists ws_flow_runs_page on ws_flow_runs (page_id, id);
    create index if not exists ws_flow_runs_waiting on ws_flow_runs (status, wake_at);
    create table if not exists ws_flow_secrets (name text primary key, value text not null, updated_at text not null);
  `);
  return d;
}

export type Flow = FlowDef & { pageId: number; lastRunAt: string | null; nextRunAt: string | null };
type FRow = { page_id: number; name: string; def: string; enabled: number; last_run_at: string | null; next_run_at: string | null };

const parse = <T>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

const toFlow = (r: FRow): Flow => {
  let def: FlowDef;
  try {
    def = normalizeFlow({ ...parse<object>(r.def, {}), name: r.name });
  } catch {
    def = { name: r.name, inputs: [], nodes: [], permissions: {}, triggers: [{ kind: "manual" }] };
  }
  return { ...def, enabled: !!r.enabled, pageId: r.page_id, lastRunAt: r.last_run_at, nextRunAt: r.next_run_at };
};

export function getFlow(pageId: number): Flow | null {
  const r = db().prepare("select * from ws_flows where page_id = ?").get(pageId) as FRow | undefined;
  return r ? toFlow(r) : null;
}

/** A flow by its name (or its page's id as text). */
export function flowByName(name: string): Flow | null {
  const id = Number(name);
  if (Number.isInteger(id) && id > 0) return getFlow(id);
  const r = db().prepare("select * from ws_flows where name = ?").get(name.trim().toLowerCase()) as FRow | undefined;
  return r ? toFlow(r) : null;
}

/** Every flow (not those in your templates, not archived). */
export function listFlows(): (Flow & { title: string; parentId: number | null })[] {
  return (db().prepare("select * from ws_flows order by name").all() as FRow[]).flatMap((r) => {
    const page = getPage(r.page_id);
    return page && !page.archivedAt && !inTemplates(page.id) ? [{ ...toFlow(r), title: page.title, parentId: page.parentId }] : [];
  });
}

const stored = (f: FlowDef) => JSON.stringify({ ...f, name: undefined, enabled: undefined });

/** A new flow: its page (under `parentId`) and its definition. The name must be free. */
export function createFlow(raw: unknown, parentId: number | null = null): Flow {
  const def = normalizeFlow(raw);
  if (flowByName(def.name)) throw new Error(`There is a flow named “${def.name}” already.`);
  const page = createPage({ parentId, title: def.title || def.name, icon: def.lookup ? "🔎" : "⚡" });
  db().prepare("insert into ws_flows (page_id, name, def, enabled) values (?, ?, ?, ?)").run(page, def.name, stored(def), def.enabled === false ? 0 : 1);
  emitChange("workspace");
  return getFlow(page)!;
}

/** An existing page made a flow (a package installed: the page is made first). The name must be free. */
export function adoptFlow(pageId: number, raw: unknown): Flow {
  const def = normalizeFlow(raw);
  if (flowByName(def.name)) throw new Error(`There is a flow named “${def.name}” already.`);
  if (getFlow(pageId)) throw new Error("This page is a flow already.");
  db().prepare("insert into ws_flows (page_id, name, def, enabled) values (?, ?, ?, ?)").run(pageId, def.name, stored(def), def.enabled === false ? 0 : 1);
  emitChange("workspace");
  return getFlow(pageId)!;
}

/** A flow's definition replaced (its name may change, if the new one is free). */
export function saveFlow(pageId: number, raw: unknown): Flow {
  const cur = getFlow(pageId);
  if (!cur) throw new Error("This page is no flow.");
  const def = normalizeFlow(raw);
  const other = flowByName(def.name);
  if (other && other.pageId !== pageId) throw new Error(`There is a flow named “${def.name}” already.`);
  // The definition it had: a version to go back to (part-versions.ts).
  const was = db().prepare("select name, def, enabled from ws_flows where page_id = ?").get(pageId) as { name: string; def: string; enabled: number };
  if (was.def !== stored(def) || was.name !== def.name || !!was.enabled !== (def.enabled !== false)) keepPartVersion("flow", pageId, { ...parse<object>(was.def, {}), name: was.name, enabled: !!was.enabled });
  db().prepare("update ws_flows set name = ?, def = ?, enabled = ?, next_run_at = null where page_id = ?").run(def.name, stored(def), def.enabled === false ? 0 : 1, pageId);
  emitChange("workspace");
  return getFlow(pageId)!;
}

/** A database a flow made is one it may write: added to its permissions (seen and taken back in the Studio). */
export function grantWrite(name: string, dbId: number): void {
  const f = flowByName(name);
  if (!f) return;
  const w = f.permissions.write;
  if (w === "all" || (Array.isArray(w) && w.includes(dbId))) return;
  const def = { ...f, permissions: { ...f.permissions, write: [...(Array.isArray(w) ? w : []), dbId] } };
  db().prepare("update ws_flows set def = ? where page_id = ?").run(stored(def), f.pageId);
}

export function deleteFlow(pageId: number): void {
  db().prepare("delete from ws_flows where page_id = ?").run(pageId);
}

export function setFlowNextRun(pageId: number, at: string | null): void {
  db().prepare("update ws_flows set next_run_at = ? where page_id = ?").run(at, pageId);
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export type RunStatus = "running" | "waiting" | "done" | "failed" | "cancelled";
export type LogEntry = { key: string; node: string; kind: string; label?: string; action?: string; status: "ok" | "failed" | "skipped" | "waiting" | "dry"; ms: number; input?: unknown; output?: unknown; error?: string; logs?: string[]; at: string; depth: number };
export type Journal = Record<string, { output: unknown; at: string; until?: string }>;
export type Waiting = { key: string; kind: "approve" | "wait" | "ask"; title?: string; text?: string; options?: string[]; until?: string; fields?: import("./types").AskField[]; /** The question (asks.ts) it waits for. */ askId?: number; expiresMinutes?: number };
export type FlowRun = { id: number; pageId: number; name: string; trigger: unknown; status: RunStatus; input: Record<string, unknown>; output: unknown; error: string | null; def: FlowDef; journal: Journal; log: LogEntry[]; waiting: Waiting | null; wakeAt: string | null; dry: boolean; startedAt: string; endedAt: string | null };
type RRow = { id: number; page_id: number; name: string; trigger: string; status: string; input: string; output: string | null; error: string | null; def: string; journal: string; log: string; waiting: string | null; wake_at: string | null; dry: number; started_at: string; ended_at: string | null };

const toRun = (r: RRow): FlowRun => ({
  id: r.id,
  pageId: r.page_id,
  name: r.name,
  trigger: parse<unknown>(r.trigger, { kind: "manual" }),
  status: r.status as RunStatus,
  input: parse<Record<string, unknown>>(r.input, {}),
  output: parse<unknown>(r.output, null),
  error: r.error,
  def: parse<FlowDef>(r.def, { name: r.name, inputs: [], nodes: [], permissions: {}, triggers: [] }),
  journal: parse<Journal>(r.journal, {}),
  log: parse<LogEntry[]>(r.log, []),
  waiting: parse<Waiting | null>(r.waiting, null),
  wakeAt: r.wake_at,
  dry: !!r.dry,
  startedAt: r.started_at,
  endedAt: r.ended_at,
});

export function startFlowRun(flow: { pageId: number; name: string; def: FlowDef }, trigger: unknown, input: Record<string, unknown>, dry: boolean): number {
  const at = new Date().toISOString();
  const r = db().prepare("insert into ws_flow_runs (page_id, name, trigger, status, input, def, dry, started_at) values (?, ?, ?, 'running', ?, ?, ?, ?)").run(flow.pageId, flow.name, JSON.stringify(trigger), JSON.stringify(input), JSON.stringify(flow.def), dry ? 1 : 0, at);
  if (!dry) db().prepare("update ws_flows set last_run_at = ? where page_id = ?").run(at, flow.pageId);
  return Number(r.lastInsertRowid);
}

export function saveFlowRun(id: number, v: { status: RunStatus; journal: Journal; log: LogEntry[]; output?: unknown; error?: string | null; waiting?: Waiting | null; wakeAt?: string | null }): void {
  const ended = v.status === "done" || v.status === "failed" || v.status === "cancelled";
  db()
    .prepare("update ws_flow_runs set status = ?, journal = ?, log = ?, output = ?, error = ?, waiting = ?, wake_at = ?, ended_at = ? where id = ?")
    .run(v.status, JSON.stringify(v.journal), JSON.stringify(v.log), v.output === undefined ? null : JSON.stringify(v.output), v.error ?? null, v.waiting ? JSON.stringify(v.waiting) : null, v.wakeAt ?? null, ended ? new Date().toISOString() : null, id);
  emitChange("workspace");
}

export const getFlowRun = (id: number): FlowRun | null => {
  const r = db().prepare("select * from ws_flow_runs where id = ?").get(id) as RRow | undefined;
  return r ? toRun(r) : null;
};

export function flowRuns(pageId: number, limit = 20, beforeId?: number): FlowRun[] {
  return (db().prepare("select * from ws_flow_runs where page_id = ? and id < ? order by id desc limit ?").all(pageId, beforeId ?? Number.MAX_SAFE_INTEGER, limit) as RRow[]).map(toRun);
}

/** The runs that wait for you (an approval, a question), newest first. */
export function waitingRuns(): FlowRun[] {
  return (db().prepare("select * from ws_flow_runs where status = 'waiting' and json_extract(waiting, '$.kind') in ('approve', 'ask') order by id desc limit 200").all() as RRow[]).map(toRun);
}

/** A flow's runs that wait at this node (a question asked again replaces the one still open). */
export function waitingAt(pageId: number, key: string, except: number): FlowRun[] {
  return (db().prepare("select * from ws_flow_runs where page_id = ? and status = 'waiting' and json_extract(waiting, '$.key') = ? and id != ?").all(pageId, key, except) as RRow[]).map(toRun);
}

/** The runs whose wait is over. */
export function dueRuns(now = new Date()): FlowRun[] {
  return (db().prepare("select * from ws_flow_runs where status = 'waiting' and wake_at is not null and wake_at <= ? order by id limit 50").all(now.toISOString()) as RRow[]).map(toRun);
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

export const SECRET_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;

export function setSecret(name: string, value: string): void {
  if (!SECRET_NAME.test(name)) throw new Error("A secret's name is capitals, digits and _ (TMDB_KEY).");
  if (!value) db().prepare("delete from ws_flow_secrets where name = ?").run(name);
  else db().prepare("insert into ws_flow_secrets (name, value, updated_at) values (?, ?, ?) on conflict(name) do update set value = excluded.value, updated_at = excluded.updated_at").run(name, value, new Date().toISOString());
}

/** The secrets' names (never their values), with when they were set. */
export const secretNames = (): { name: string; updatedAt: string }[] => (db().prepare("select name, updated_at from ws_flow_secrets order by name").all() as { name: string; updated_at: string }[]).map((r) => ({ name: r.name, updatedAt: r.updated_at }));

/** Every secret — for a run only (server side). */
export const secretValues = (): Record<string, string> => Object.fromEntries((db().prepare("select name, value from ws_flow_secrets").all() as { name: string; value: string }[]).map((r) => [r.name, r.value]));
