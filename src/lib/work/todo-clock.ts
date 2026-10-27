/**
 * A todo's clock, per agent: started before the work on a todo begins, stopped after it — Zeff takes the difference as the
 * time record (todo-time.ts), not the agent's guess. One clock at a time per agent: starting on another todo stops the one
 * running (switched). Waiting for the user doesn't count: the clock pauses while the todo asks you something
 * (todo_needs_input) and goes on with the next progress note. A lap (todo_time without minutes) records the time so far and
 * runs on from now. Kept with the account's settings (open clocks only). Server only.
 */
import { getPref, setPref } from "@/lib/prefs";
import { addTodoTime } from "./todo-time";
import type { TimeRecord } from "./shared";

type Clock = { todoId: number; agent: string; startedAt: string; pausedAt: string | null; pausedMs: number };
const KEY = "todo-clocks";

const agentOf = (agent?: string | null) => (agent ?? "").trim().slice(0, 60) || "Agent";
const keyOf = (todoId: number, agent: string) => `${todoId}|${agent.toLowerCase()}`;
const read = () => getPref<Record<string, Clock>>(KEY, {});
/** The key of an agent's clock on a todo — no agent named: the todo's only clock, if it has one. */
function find(all: Record<string, Clock>, todoId: number, agent?: string | null): string | null {
  const k = keyOf(todoId, agentOf(agent));
  if (all[k]) return k;
  if ((agent ?? "").trim()) return null;
  const on = Object.entries(all).filter(([, c]) => c.todoId === todoId);
  return on.length === 1 ? on[0][0] : null;
}
const write = (all: Record<string, Clock>) => setPref(KEY, all);

/** The milliseconds a clock has run (its pauses left out) up to `now`. */
function ranMs(c: Clock, now: number): number {
  const paused = c.pausedMs + (c.pausedAt ? Math.max(0, now - Date.parse(c.pausedAt)) : 0);
  return Math.max(0, now - Date.parse(c.startedAt) - paused);
}

/** The running clock of an agent on a todo (null: none). */
export function openClock(todoId: number, agent?: string | null): (Clock & { minutes: number }) | null {
  const all = read();
  const k = find(all, todoId, agent);
  const c = k ? all[k] : undefined;
  return c ? { ...c, minutes: ranMs(c, Date.now()) / 60000 } : null;
}

/** All running clocks (the Code tab, the brief). */
export const openClocks = (): Clock[] => Object.values(read());

/** The minutes of a stretch as a record takes them: at least one, whole minutes. */
const asMinutes = (ms: number) => Math.max(1, Math.round(ms / 60000));

/**
 * Starts the clock of `agent` on a todo — now. Running already on it: left as it is (since then). Running on another todo:
 * that one is stopped first and its time recorded ("switched to T-…"). What was stopped, if anything.
 */
export function clockIn(todoId: number, agent?: string | null, now = Date.now()): { since: string; resumed: boolean; switched: TimeRecord | null } {
  const who = agentOf(agent);
  const all = read();
  const mine = all[keyOf(todoId, who)];
  if (mine) {
    // Paused (waiting for the user): it goes on.
    if (mine.pausedAt) {
      mine.pausedMs += Math.max(0, now - Date.parse(mine.pausedAt));
      mine.pausedAt = null;
      write(all);
    }
    return { since: mine.startedAt, resumed: true, switched: null };
  }
  let switched: TimeRecord | null = null;
  for (const [k, c] of Object.entries(all)) {
    if (c.agent.toLowerCase() !== who.toLowerCase()) continue;
    const ms = ranMs(c, now);
    delete all[k];
    if (ms >= 30000) switched = addTodoTime({ todoId: c.todoId, minutes: asMinutes(ms), note: `switched to T-${todoId}`, by: c.agent, source: "agent", at: new Date(now).toISOString() });
  }
  all[keyOf(todoId, who)] = { todoId, agent: who, startedAt: new Date(now).toISOString(), pausedAt: null, pausedMs: 0 };
  write(all);
  return { since: all[keyOf(todoId, who)].startedAt, resumed: false, switched };
}

/**
 * Stops the clock of `agent` on a todo: the time it ran (pauses left out) as one time record with `note` — unless `record` is
 * false (finish_todo records it itself). The minutes, and the record; null when no clock ran.
 */
export function clockOut(todoId: number, agent?: string | null, opts: { note?: string; record?: boolean; now?: number } = {}): { minutes: number; record: TimeRecord | null } | null {
  const all = read();
  const k = find(all, todoId, agent);
  const c = k ? all[k] : undefined;
  if (!k || !c) return null;
  const now = opts.now ?? Date.now();
  const minutes = asMinutes(ranMs(c, now));
  delete all[k];
  write(all);
  const record = opts.record === false ? null : addTodoTime({ todoId, minutes, note: opts.note, by: c.agent, source: "agent", at: new Date(now).toISOString() });
  return { minutes, record };
}

/** A lap: the time since the clock started (or the last lap) recorded, the clock running on from now. Null: no clock ran. */
export function clockLap(todoId: number, agent?: string | null, note?: string, now = Date.now()): { minutes: number; record: TimeRecord } | null {
  const all = read();
  const k = find(all, todoId, agent);
  const c = k ? all[k] : undefined;
  if (!k || !c) return null;
  const minutes = asMinutes(ranMs(c, now));
  const record = addTodoTime({ todoId, minutes, note, by: c.agent, source: "agent", at: new Date(now).toISOString() });
  all[k] = { ...c, startedAt: new Date(now).toISOString(), pausedAt: c.pausedAt ? new Date(now).toISOString() : null, pausedMs: 0 };
  write(all);
  return { minutes, record };
}

/** Waiting for the user on a todo: every clock on it paused (goes on with clockResume / the next progress note). */
export function clockPause(todoId: number, now = Date.now()): number {
  const all = read();
  let n = 0;
  for (const c of Object.values(all))
    if (c.todoId === todoId && !c.pausedAt) {
      c.pausedAt = new Date(now).toISOString();
      n++;
    }
  if (n) write(all);
  return n;
}

/** Going on with a todo: its paused clocks run again. */
export function clockResume(todoId: number, now = Date.now()): number {
  const all = read();
  let n = 0;
  for (const c of Object.values(all))
    if (c.todoId === todoId && c.pausedAt) {
      c.pausedMs += Math.max(0, now - Date.parse(c.pausedAt));
      c.pausedAt = null;
      n++;
    }
  if (n) write(all);
  return n;
}
