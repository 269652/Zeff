import { isInstalled } from "@/plugins/state";
import { isQuiet, quietly, type RowEvent } from "./events";
import { getPage } from "./store";
import { listRoutines, setNextRun, type Trigger } from "./routines";
import { runRoutine } from "./routine-run";

/**
 * When routines run by themselves: on a schedule (every N minutes, or at a time of day on some weekdays) and when something happens
 * in a database (a row added or changed, a pipeline through). A routine's own changes never trigger routines again.
 */

type Schedule = Extract<Trigger, { kind: "schedule" }>;

/** The next time a schedule is due after a moment (local time); null for a trigger that is no schedule. */
export function nextRunAfter(trigger: Trigger, from: Date): Date | null {
  if (trigger.kind !== "schedule") return null;
  if (trigger.everyMinutes) return new Date(from.getTime() + trigger.everyMinutes * 60000);
  const m = trigger.at ? /^(\d{2}):(\d{2})$/.exec(trigger.at) : null;
  if (!m) return null;
  const days = trigger.days?.length ? trigger.days : [0, 1, 2, 3, 4, 5, 6];
  for (let add = 0; add < 8; add++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + add, Number(m[1]), Number(m[2]));
    if (d.getTime() > from.getTime() && days.includes(d.getDay())) return d;
  }
  return null;
}

const schedulesOf = (triggers: Trigger[]): Schedule[] => triggers.filter((t): t is Schedule => t.kind === "schedule");

/**
 * Routines whose time has come run — each once; then planned again. The first look at a routine only plans it (a routine switched
 * on does not run at that moment). Disabled routines, and those without a schedule, never. How many ran.
 */
export async function runDueRoutines(now = new Date()): Promise<number> {
  let ran = 0;
  for (const r of listRoutines()) {
    const schedules = schedulesOf(r.triggers);
    if (!r.enabled || !schedules.length) continue;
    const plan = (from: Date) => setNextRun(r.pageId, new Date(Math.min(...schedules.map((s) => nextRunAfter(s, from)?.getTime() ?? Infinity))).toISOString());
    if (!r.nextRunAt) {
      plan(now);
      continue;
    }
    if (new Date(r.nextRunAt).getTime() > now.getTime()) continue;
    plan(now);
    const due = schedules.find((s) => nextRunAfter(s, new Date(new Date(r.nextRunAt!).getTime() - 1)) !== null) ?? schedules[0];
    try {
      await quietly(() => runRoutine(r.pageId, due, {}));
    } catch (e) {
      console.error(`[workspace] the routine ${r.pageId} failed to start: ${e instanceof Error ? e.message : e}`);
    }
    ran++;
  }
  return ran;
}

export type EventInfo = { db?: number; row?: number; field?: string; created?: number; /** A signal: its name and what it carries. */ name?: string; payload?: Record<string, string> };

/** Something happened: the routines that listen run — in turn, with the row in hand. Not while a routine runs or a pipeline writes. */
export async function fireRoutineEvent(event: RowEvent | "pipeline.ran" | "signal", info: EventInfo, opts: { force?: boolean; depth?: number } = {}): Promise<number> {
  // (A signal is sent on purpose, also from inside a routine: `force`. How deep signals went is carried along.)
  if ((isQuiet() && !opts.force) || !isInstalled("workspace")) return 0;
  const fieldName = info.field?.toLowerCase();
  const title = info.row ? (getPage(info.row)?.title ?? "") : "";
  let ran = 0;
  for (const r of listRoutines()) {
    if (!r.enabled) continue;
    const t = r.triggers.find((x) => x.kind === "event" && x.event === event && (!x.db || x.db === info.db) && (!x.field || x.field.toLowerCase() === fieldName) && (event !== "signal" || x.name === info.name));
    if (!t) continue;
    try {
      await quietly(() => runRoutine(r.pageId, t, { row: info.row, depth: opts.depth, payload: { event, title, field: info.field ?? "", db: String(info.db ?? ""), ...(info.name ? { name: info.name } : {}), ...(info.payload ?? {}) } }));
    } catch (e) {
      console.error(`[workspace] the routine ${r.pageId} failed: ${e instanceof Error ? e.message : e}`);
    }
    ran++;
  }
  return ran;
}
