import { getSqlite } from "@/db";
import { FILTER_OPS, newId, type FilterRule } from "./model";
import { getPage } from "./store";

/**
 * Routines — Automations (deterministic steps, one after another, with gates, branches and conditions) and Agents (an LLM run on
 * the instructions of a page). A routine is a page of the Workspace with a configuration: when it runs (its triggers), what it may
 * touch (its permissions) and, for an automation, its steps. What ran is kept in a log. Server only.
 */

// ---------------------------------------------------------------------------
// The configuration
// ---------------------------------------------------------------------------

export const ROUTINE_KINDS = ["agent", "automation"] as const;
export type RoutineKind = (typeof ROUTINE_KINDS)[number];

export const EVENTS = ["row.added", "row.changed", "pipeline.ran"] as const;
export type RoutineEvent = (typeof EVENTS)[number];

/** When a routine runs: when you start it, on a schedule, when something happens, or when something else calls it. */
export type Trigger =
  | { kind: "manual" }
  | { kind: "schedule"; everyMinutes?: number; at?: string; days?: number[] }
  | { kind: "event"; event: RoutineEvent; db?: number; field?: string }
  | { kind: "called" };

/** What a routine may change: only its own page and what is below it, its parent's pages, the whole workspace, or nothing. */
export const SCOPES = ["self", "parent", "workspace", "none"] as const;
export type Scope = (typeof SCOPES)[number];
export type Permissions = { scope: Scope };

/** Conditions on a record (the row in hand, or what triggered the run): all of the rules, or any. */
export type Condition = { match?: "all" | "any"; rules: FilterRule[] };

/** An operation of an automation. Operations run one after another; `if`, `stop` and `foreach` steer them. */
export type Step =
  | { id: string; kind: "set"; field: string; value: string }
  | { id: string; kind: "create"; db: number; title: string; fields?: Record<string, string> }
  | { id: string; kind: "archive" }
  | { id: string; kind: "pipeline"; db: number }
  | { id: string; kind: "run"; page: number }
  | { id: string; kind: "notify"; text: string }
  | { id: string; kind: "stop"; when?: Condition }
  | { id: string; kind: "if"; when: Condition; then: Step[]; else: Step[] }
  | { id: string; kind: "foreach"; db: number; where?: Condition; steps: Step[] };

export type RoutineConfig = {
  kind: RoutineKind;
  enabled: boolean;
  triggers: Trigger[];
  permissions: Permissions;
  /** An automation's steps. */
  steps: Step[];
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const posInt = (v: unknown): number | undefined => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

function normalizeTime(v: unknown): string | undefined {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(str(v));
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` : undefined;
}

function normalizeTrigger(raw: unknown): Trigger | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (o.kind === "manual") return { kind: "manual" };
  if (o.kind === "called") return { kind: "called" };
  if (o.kind === "schedule") {
    const every = posInt(o.everyMinutes);
    const at = normalizeTime(o.at);
    const days = Array.isArray(o.days) ? [...new Set(o.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
    if (every) return { kind: "schedule", everyMinutes: Math.min(10080, every) };
    if (at) return { kind: "schedule", at, ...(days.length ? { days } : {}) };
    return null;
  }
  if (o.kind === "event") {
    if (!(EVENTS as readonly unknown[]).includes(o.event)) return null;
    const db = posInt(o.db);
    const field = str(o.field);
    return { kind: "event", event: o.event as RoutineEvent, ...(db ? { db } : {}), ...(field ? { field } : {}) };
  }
  return null;
}

function normalizeCondition(raw: unknown): Condition | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rules = (Array.isArray(o.rules) ? o.rules : []).flatMap((x): FilterRule[] => {
    const r = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const field = str(r.field);
    if (!field || !(FILTER_OPS as readonly unknown[]).includes(r.op)) return [];
    return [{ field, op: r.op as FilterRule["op"], ...(typeof r.value === "string" ? { value: r.value } : {}) }];
  });
  return rules.length ? { rules, ...(o.match === "any" ? { match: "any" as const } : {}) } : null;
}

export function normalizeSteps(raw: unknown, depth = 0): Step[] {
  if (!Array.isArray(raw) || depth > 6) return [];
  const out: Step[] = [];
  for (const x of raw) {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const id = str(o.id) || newId("st");
    switch (o.kind) {
      case "set":
        if (str(o.field)) out.push({ id, kind: "set", field: str(o.field), value: typeof o.value === "string" ? o.value : "" });
        break;
      case "create":
        if (posInt(o.db)) {
          const fields = o.fields && typeof o.fields === "object" ? Object.fromEntries(Object.entries(o.fields as Record<string, unknown>).filter(([, v]) => typeof v === "string") as [string, string][]) : undefined;
          out.push({ id, kind: "create", db: posInt(o.db)!, title: typeof o.title === "string" ? o.title : "", ...(fields && Object.keys(fields).length ? { fields } : {}) });
        }
        break;
      case "archive":
        out.push({ id, kind: "archive" });
        break;
      case "pipeline":
        if (posInt(o.db)) out.push({ id, kind: "pipeline", db: posInt(o.db)! });
        break;
      case "run":
        if (posInt(o.page)) out.push({ id, kind: "run", page: posInt(o.page)! });
        break;
      case "notify":
        out.push({ id, kind: "notify", text: typeof o.text === "string" ? o.text : "" });
        break;
      case "stop": {
        const when = normalizeCondition(o.when);
        out.push({ id, kind: "stop", ...(when ? { when } : {}) });
        break;
      }
      case "if": {
        const when = normalizeCondition(o.when);
        if (when) out.push({ id, kind: "if", when, then: normalizeSteps(o.then, depth + 1), else: normalizeSteps(o.else, depth + 1) });
        break;
      }
      case "foreach":
        if (posInt(o.db)) {
          const where = normalizeCondition(o.where);
          out.push({ id, kind: "foreach", db: posInt(o.db)!, ...(where ? { where } : {}), steps: normalizeSteps(o.steps, depth + 1) });
        }
        break;
    }
  }
  return out;
}

/** A configuration as stored: kept to what it can be. */
export function normalizeRoutine(raw: unknown): RoutineConfig {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const triggers = (Array.isArray(o.triggers) ? o.triggers : []).map(normalizeTrigger).filter((t): t is Trigger => !!t);
  const perms = (o.permissions && typeof o.permissions === "object" ? o.permissions : {}) as Record<string, unknown>;
  return {
    kind: o.kind === "automation" ? "automation" : "agent",
    enabled: o.enabled === true,
    triggers: triggers.length ? triggers : [{ kind: "manual" }],
    permissions: { scope: (SCOPES as readonly unknown[]).includes(perms.scope) ? (perms.scope as Scope) : "self" },
    steps: normalizeSteps(o.steps),
  };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function db() {
  const d = getSqlite();
  d.exec(`
    create table if not exists ws_routines (page_id integer primary key, kind text not null, enabled integer not null default 0, config text not null, last_run_at text, next_run_at text);
    create table if not exists ws_routine_runs (id integer primary key autoincrement, page_id integer not null, trigger text not null, status text not null, started_at text not null, ended_at text, log text not null default '[]', error text, work_run_id integer);
    create index if not exists ws_routine_runs_page on ws_routine_runs (page_id, id);
  `);
  return d;
}

export type Routine = RoutineConfig & { pageId: number; lastRunAt: string | null; nextRunAt: string | null };
type RRow = { page_id: number; kind: string; enabled: number; config: string; last_run_at: string | null; next_run_at: string | null };

const parse = <T>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

const toRoutine = (r: RRow): Routine => ({ ...normalizeRoutine({ ...parse<object>(r.config, {}), kind: r.kind, enabled: !!r.enabled }), pageId: r.page_id, lastRunAt: r.last_run_at, nextRunAt: r.next_run_at });

export function getRoutine(pageId: number): Routine | null {
  const r = db().prepare("select * from ws_routines where page_id = ?").get(pageId) as RRow | undefined;
  return r ? toRoutine(r) : null;
}

/** A routine for a page — off until you switch it on, started by hand only. */
export function createRoutine(pageId: number, kind: RoutineKind, config: Partial<RoutineConfig> = {}): Routine {
  if (!getPage(pageId)) throw new Error("There is no such page.");
  if (getRoutine(pageId)) throw new Error("This page is a routine already.");
  const c = normalizeRoutine({ ...config, kind, enabled: config.enabled ?? false });
  db().prepare("insert into ws_routines (page_id, kind, enabled, config) values (?, ?, ?, ?)").run(pageId, c.kind, c.enabled ? 1 : 0, JSON.stringify({ triggers: c.triggers, permissions: c.permissions, steps: c.steps }));
  return getRoutine(pageId)!;
}

/** Changes to a routine (what is given replaces what was). */
export function updateRoutine(pageId: number, patch: Partial<Pick<RoutineConfig, "enabled" | "triggers" | "permissions" | "steps">>): Routine {
  const cur = getRoutine(pageId);
  if (!cur) throw new Error("This page is no routine.");
  const next = normalizeRoutine({ ...cur, ...patch });
  db().prepare("update ws_routines set enabled = ?, config = ?, next_run_at = null where page_id = ?").run(next.enabled ? 1 : 0, JSON.stringify({ triggers: next.triggers, permissions: next.permissions, steps: next.steps }), pageId);
  return getRoutine(pageId)!;
}

export function deleteRoutine(pageId: number): void {
  db().prepare("delete from ws_routines where page_id = ?").run(pageId);
}

/** Every routine, with its page's title. */
export function listRoutines(): (Routine & { title: string })[] {
  return (db().prepare("select * from ws_routines order by page_id").all() as RRow[]).flatMap((r) => {
    const page = getPage(r.page_id);
    return page && !page.archivedAt ? [{ ...toRoutine(r), title: page.title }] : [];
  });
}

/** When it is due next (set by the scheduler). */
export function setNextRun(pageId: number, at: string | null): void {
  db().prepare("update ws_routines set next_run_at = ? where page_id = ?").run(at, pageId);
}

// ---------------------------------------------------------------------------
// The log
// ---------------------------------------------------------------------------

export type StepLog = { step: string; kind: string; status: "ok" | "skipped" | "failed"; note: string; depth?: number };
export type RunStatus = "running" | "done" | "stopped" | "failed";
export type RoutineRun = { id: number; pageId: number; trigger: Trigger; status: RunStatus; startedAt: string; endedAt: string | null; log: StepLog[]; error: string | null; workRunId: number | null };
type LRow = { id: number; page_id: number; trigger: string; status: string; started_at: string; ended_at: string | null; log: string; error: string | null; work_run_id: number | null };

const toRun = (r: LRow): RoutineRun => ({ id: r.id, pageId: r.page_id, trigger: parse<Trigger>(r.trigger, { kind: "manual" }), status: r.status as RunStatus, startedAt: r.started_at, endedAt: r.ended_at, log: parse<StepLog[]>(r.log, []), error: r.error, workRunId: r.work_run_id });

/** A run begins. */
export function startRun(pageId: number, trigger: Trigger): number {
  const at = new Date().toISOString();
  const r = db().prepare("insert into ws_routine_runs (page_id, trigger, status, started_at) values (?, ?, 'running', ?)").run(pageId, JSON.stringify(trigger), at);
  db().prepare("update ws_routines set last_run_at = ? where page_id = ?").run(at, pageId);
  return Number(r.lastInsertRowid);
}

/** A run ends: how it went and what each step did. */
export function finishRun(runId: number, v: { status: Exclude<RunStatus, "running">; log: StepLog[]; error?: string; workRunId?: number }): void {
  db()
    .prepare("update ws_routine_runs set status = ?, ended_at = ?, log = ?, error = ?, work_run_id = coalesce(?, work_run_id) where id = ?")
    .run(v.status, new Date().toISOString(), JSON.stringify(v.log), v.error ?? null, v.workRunId ?? null, runId);
}

/** The worker run an agent's run is (it shows in the Code tab). */
export function setWorkRun(runId: number, workRunId: number): void {
  db().prepare("update ws_routine_runs set work_run_id = ? where id = ?").run(workRunId, runId);
}

/** The newest runs of a routine first. */
export function routineRuns(pageId: number, limit = 20): RoutineRun[] {
  return (db().prepare("select * from ws_routine_runs where page_id = ? order by id desc limit ?").all(pageId, limit) as LRow[]).map(toRun);
}

export const getRun = (runId: number): RoutineRun | null => {
  const r = db().prepare("select * from ws_routine_runs where id = ?").get(runId) as LRow | undefined;
  return r ? toRun(r) : null;
};

/** The runs of agents still going: those with a worker run, not ended. */
export function runningAgentRuns(): RoutineRun[] {
  return (db().prepare("select * from ws_routine_runs where status = 'running' and work_run_id is not null order by id").all() as LRow[]).map(toRun);
}

/** The routine whose agent a worker run is (the newest run of it) — what an MCP request from that worker is allowed to do follows from it. */
export function routineOfWorkRun(workRunId: number): number | null {
  const r = db().prepare("select page_id from ws_routine_runs where work_run_id = ? order by id desc limit 1").get(workRunId) as { page_id: number } | undefined;
  return r?.page_id ?? null;
}
