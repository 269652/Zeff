import { emitChange } from "@/lib/events";
import { setFields } from "./api";
import { cellText } from "./model";
import { conditionHolds, fillTemplate, type RecordOf, type TemplateContext } from "./routine-conditions";
import { finishRun, getRoutine, startRun, type Condition, type RunStatus, type Step, type StepLog, type Trigger } from "./routines";
import { addRow, archivePage, getDatabase, getPage, rawRows } from "./store";

/**
 * The automation engine. A routine's steps run one after another on the row in hand (the one that triggered the run, or each row
 * of a foreach): set a field, create a row, archive it, refresh a database, run another routine, notify — steered by gates (stop),
 * branches (if / else) and loops (foreach), on conditions as a filter's rules. Deterministic: no AI in it. Every step is logged,
 * and a failing step ends the run.
 */

export type Deps = {
  /** A database's sources read again (its pipeline run). */
  refresh: (dbId: number) => Promise<void>;
  /** Another routine run — an agent starts (and goes on in the background), an automation runs through. */
  runRoutine: (pageId: number, trigger: Trigger, ctx: { row?: number; payload?: Record<string, string>; depth: number }) => Promise<{ status: RunStatus | "started"; error?: string }>;
  /** A note for you: shown with the run, and to the open pages. */
  notify: (text: string) => void;
  /** A method a plugin offers to automations, called. */
  call: (method: string, params: Record<string, string>) => Promise<unknown>;
  /** A signal sent: the routines that listen run (one after another) — `depth` carries how deep signals have gone. */
  signal: (name: string, payload: Record<string, string>, depth: number) => Promise<void>;
};

export type RunOptions = {
  /** The row in hand. */
  row?: number;
  /** What triggered it, as text (an event's row title, the caller's words …): `{{payload.x}}`. */
  payload?: Record<string, string>;
  deps?: Partial<Deps>;
  limits?: { steps?: number; depth?: number };
  depth?: number;
};

export type RunResult = { runId: number; status: Exclude<RunStatus, "running">; log: StepLog[]; error?: string };

const LIMITS = { steps: 500, depth: 4 };

/** A row's fields by name (lower case) — what conditions and templates read. */
export function recordOfRow(rowId: number): RecordOf {
  const page = getPage(rowId);
  if (!page?.dbId) return {};
  const d = getDatabase(page.dbId);
  const row = rawRows(page.dbId).find((r) => r.id === rowId);
  if (!d || !row) return {};
  const rec: RecordOf = { title: row.title, [d.schema.titleName.toLowerCase()]: row.title };
  for (const p of d.schema.properties) {
    const v = row.cells[p.id];
    rec[p.name.toLowerCase()] = p.type === "checkbox" ? v === true : p.type === "number" ? (typeof v === "number" ? v : null) : cellText(p, v);
  }
  return rec;
}

const realDeps = (): Deps => ({
  refresh: async (dbId) => {
    const p = await import("./pipeline");
    await p.startPipeline(dbId, { ai: false }).done;
  },
  runRoutine: async (pageId, trigger, ctx) => (await import("./routine-run")).runRoutine(pageId, trigger, ctx),
  notify: (text) => {
    // Kept with the run (its log line); the pages refresh.
    void text;
    emitChange("workspace");
  },
  call: async (method, params) => (await import("./routine-methods")).callAutomatic(method, params),
  signal: async (name, payload, depth) => {
    await (await import("./routine-triggers")).fireRoutineEvent("signal", { name, payload }, { force: true, depth });
  },
});

class Stop extends Error {}
class Fail extends Error {}

/** A routine's steps run. Its run is logged (what each step did, how it ended). */
export async function runAutomation(pageId: number, trigger: Trigger, opts: RunOptions = {}): Promise<RunResult> {
  const routine = getRoutine(pageId);
  if (!routine) throw new Error("This page is no routine.");
  const deps: Deps = { ...realDeps(), ...opts.deps };
  const limits = { ...LIMITS, ...opts.limits };
  const depth = opts.depth ?? 0;
  const runId = startRun(pageId, trigger);
  const log: StepLog[] = [];
  let count = 0;
  const say = (step: Step, status: StepLog["status"], note: string, level: number) => log.push({ step: step.id, kind: step.kind, status, note, ...(level ? { depth: level } : {}) });

  const exec = async (steps: Step[], row: number | undefined, level: number): Promise<void> => {
    for (const step of steps) {
      if (++count > limits.steps) throw new Fail(`More than ${limits.steps} steps — the run is stopped.`);
      const rec = row ? recordOfRow(row) : {};
      const ctx: TemplateContext = { row: rec, trigger, payload: opts.payload };
      try {
        switch (step.kind) {
          case "set": {
            if (!row) throw new Fail("This step needs a row in hand (a trigger with a row, or a foreach).");
            const value = fillTemplate(step.value, ctx);
            setFields(getPage(row)!.dbId!, row, { [step.field]: value });
            say(step, "ok", `${step.field} = ${value}`, level);
            break;
          }
          case "create": {
            if (!getDatabase(step.db)) throw new Fail("There is no such database.");
            const title = fillTemplate(step.title, ctx).trim() || "Untitled";
            const id = addRow(step.db, { title });
            setFields(step.db, id, Object.fromEntries(Object.entries(step.fields ?? {}).map(([k, v]) => [k, fillTemplate(v, ctx)])));
            say(step, "ok", `Row “${title}” made`, level);
            break;
          }
          case "archive": {
            if (!row) throw new Fail("This step needs a row in hand (a trigger with a row, or a foreach).");
            archivePage(row);
            say(step, "ok", "Moved to the trash", level);
            break;
          }
          case "pipeline":
            await deps.refresh(step.db);
            say(step, "ok", `Database ${step.db} read again`, level);
            break;
          case "run": {
            if (depth + 1 > limits.depth) throw new Fail("Routines call each other too deep (a loop?).");
            const r = await deps.runRoutine(step.page, { kind: "called" }, { row, payload: opts.payload, depth: depth + 1 });
            say(step, r.status === "failed" ? "failed" : "ok", `Routine ${step.page}: ${r.status}`, level);
            if (r.status === "failed") throw new Fail(`The routine ${step.page} failed${r.error ? `: ${r.error}` : "."}`);
            break;
          }
          case "notify": {
            const text = fillTemplate(step.text, ctx);
            deps.notify(text);
            say(step, "ok", text, level);
            break;
          }
          case "call": {
            const params = Object.fromEntries(Object.entries(step.params).map(([k, v]) => [k, fillTemplate(v, ctx)]));
            const answer = await deps.call(step.method, params);
            say(step, "ok", `${step.method}${answer && typeof answer === "object" && "id" in answer ? ` → ${String((answer as { id: unknown }).id)}` : ""}`, level);
            break;
          }
          case "signal": {
            if (depth + 1 > limits.depth) throw new Fail("Signals go round too deep (a loop?).");
            const payload = Object.fromEntries(Object.entries(step.payload ?? {}).map(([k, v]) => [k, fillTemplate(v, ctx)]));
            await deps.signal(step.name, payload, depth + 1);
            say(step, "ok", `Signal ${step.name}`, level);
            break;
          }
          case "stop": {
            if (conditionHolds(step.when, rec)) {
              say(step, "ok", "Stopped here", level);
              throw new Stop();
            }
            say(step, "skipped", "Condition not met — goes on", level);
            break;
          }
          case "if": {
            const yes = conditionHolds(step.when, rec);
            say(step, "ok", yes ? "then" : "else", level);
            await exec(yes ? step.then : step.else, row, level + 1);
            break;
          }
          case "foreach": {
            const d = getDatabase(step.db);
            if (!d) throw new Fail("There is no such database.");
            const rows = rawRows(step.db).filter((r) => !getPage(r.id)?.archivedAt && conditionHolds(step.where as Condition | undefined, recordOfRow(r.id)));
            say(step, "ok", `${rows.length} rows`, level);
            for (const r of rows) await exec(step.steps, r.id, level + 1);
            break;
          }
        }
      } catch (e) {
        if (e instanceof Stop) throw e;
        if (!log.some((l) => l.step === step.id && l.status === "failed")) say(step, "failed", e instanceof Error ? e.message : String(e), level);
        throw e instanceof Fail ? e : new Fail(e instanceof Error ? e.message : String(e));
      }
    }
  };

  let status: RunResult["status"] = "done";
  let error: string | undefined;
  try {
    await exec(routine.steps, opts.row, 0);
  } catch (e) {
    if (e instanceof Stop) status = "stopped";
    else {
      status = "failed";
      error = e instanceof Error ? e.message : String(e);
    }
  }
  finishRun(runId, { status, log, ...(error ? { error } : {}) });
  emitChange("workspace");
  return { runId, status, log, ...(error ? { error } : {}) };
}
