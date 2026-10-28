/**
 * A todo's clock, per agent: started before the work on a todo begins, stopped after it — Zeff takes the difference as the
 * time record (todo-time.ts), not the agent's guess. One clock at a time per agent: starting on another todo stops the one
 * running (switched). Waiting for the user doesn't count: the clock pauses while the todo asks you something
 * (todo_needs_input) and goes on with the next progress note. A lap (todo_time without minutes) records the time so far and
 * runs on from now.
 *
 * A running clock needs a sign of life at least every PING_MINUTES (todo_clock_ping — or todo_progress, todo_time, starting
 * it again): without one it is paused as of the last one — the time after it isn't proven, so it doesn't count. The next
 * sign of life goes on from then (the silence left out). A Claude Code session that started the clock needs no pings: each step
 * in its transcript is a sign of life (clock-activity.ts). Worked out when the clock is read, not by a timer. Kept with the
 * account's settings (open clocks only). Server only.
 */
import { getPref, setPref } from "@/lib/prefs";
import { addTodoTime } from "./todo-time";
import { sessionActivity } from "./clock-activity";
import type { TimeRecord } from "./shared";
import { ValidationError } from "@/lib/errors";

/** Minutes a running clock goes without a sign of life before it is paused (as of the last one). */
export const PING_MINUTES = 10;
const PING_MS = PING_MINUTES * 60000;

/** The time rule every agent reads where it meets a todo (list_todos, ticket_brief) — not only in the server's instructions, which not every client (VS Code Copilot) shows its model. */
export const CLOCK_RULE =
  "Working on one of these? Its time MUST be measured — for every agent (Copilot, Claude Code, a Zeff worker): start_todo (or todo_clock_start) BEFORE you begin, todo_clock_ping AT LEAST EVERY 10 MINUTES while you work (silent longer, the clock pauses as of your last ping and that time is lost), todo_clock_stop when you stop or switch, finish_todo when you're through. Only measured time is booked: never state minutes or hours yourself — can't ping reliably? Read the time (date -u +%FT%TZ) when you begin and when you stop, and give both as log: { from, to } to todo_clock_stop / finish_todo.";

type Clock = {
  todoId: number;
  agent: string;
  startedAt: string;
  /** Paused since (waiting for the user, or silent too long — `silent`); null: running. */
  pausedAt: string | null;
  pausedMs: number;
  /** The last sign of life (a ping, a lap, a progress note, the start). */
  lastPing?: string;
  /** Paused because no sign of life came in time (not by a question to the user). */
  silent?: boolean;
};
const KEY = "todo-clocks";

const agentOf = (agent?: string | null) => (agent ?? "").trim().slice(0, 60) || "Agent";
const keyOf = (todoId: number, agent: string) => `${todoId}|${agent.toLowerCase()}`;
const read = () => getPref<Record<string, Clock>>(KEY, {});
const write = (all: Record<string, Clock>) => setPref(KEY, all);
const iso = (ms: number) => new Date(ms).toISOString();

/** The key of an agent's clock on a todo — no agent named: the todo's only clock, if it has one. */
function find(all: Record<string, Clock>, todoId: number, agent?: string | null): string | null {
  const k = keyOf(todoId, agentOf(agent));
  if (all[k]) return k;
  if ((agent ?? "").trim()) return null;
  const on = Object.entries(all).filter(([, c]) => c.todoId === todoId);
  return on.length === 1 ? on[0][0] : null;
}

/** Silent too long (running, no sign of life for PING_MINUTES — no ping, no step of its session): paused as of its last sign of life. Whether it changed. */
function settle(c: Clock, now: number): boolean {
  // Waiting for the user: paused until the work goes on.
  if (c.pausedAt && !c.silent) return false;
  const from = Date.parse(c.silent ? c.pausedAt! : (c.lastPing ?? c.startedAt));
  if (!c.silent && now - from <= PING_MS) return false;
  const was = JSON.stringify(c);
  // The agent's own session worked on it meanwhile (its steps in its transcript — no ping needed, clock-activity.ts): each
  // step is a sign of life as a ping is — a silence of more than PING_MINUTES between them left out, as between pings.
  // (Judged again from its last sign of life: a clock paused for silence may have worked on after all.)
  c.pausedAt = null;
  c.silent = false;
  let last = from;
  for (const t of sessionActivity(`T-${c.todoId}`, from, now)) {
    if (t - last > PING_MS) c.pausedMs += t - last;
    last = t;
  }
  c.lastPing = iso(last);
  if (now - last > PING_MS) {
    c.pausedAt = iso(last);
    c.silent = true;
  }
  return JSON.stringify(c) !== was;
}

/** A sign of life: silent too long, it goes on from now (the silence left out); running, its last sign of life is now. */
function beat(c: Clock, now: number, opts: { resumeQuestion?: boolean } = {}): void {
  settle(c, now);
  if (c.pausedAt && (c.silent || opts.resumeQuestion)) {
    c.pausedMs += Math.max(0, now - Date.parse(c.pausedAt));
    c.pausedAt = null;
    c.silent = false;
  }
  c.lastPing = iso(now);
}

/** The milliseconds a clock has run (its pauses left out) up to `now`. */
function ranMs(c: Clock, now: number): number {
  const paused = c.pausedMs + (c.pausedAt ? Math.max(0, now - Date.parse(c.pausedAt)) : 0);
  return Math.max(0, now - Date.parse(c.startedAt) - paused);
}

export type ClockView = Clock & { minutes: number; state: "running" | "waiting" | "silent" };

/** An agent's clock on a todo as it stands now (null: none) — paused when it went silent. */
export function openClock(todoId: number, agent?: string | null, now = Date.now()): ClockView | null {
  const all = read();
  const k = find(all, todoId, agent);
  if (!k) return null;
  const c = { ...all[k] };
  settle(c, now);
  return { ...c, minutes: ranMs(c, now) / 60000, state: !c.pausedAt ? "running" : c.silent ? "silent" : "waiting" };
}

/** All open clocks (the Code tab, the brief). */
export const openClocks = (): Clock[] => Object.values(read());

/**
 * The agent's own record of a stretch — for when its clock went quiet (it didn't ping): times it READ, not guessed — from its
 * session (its steps' times), or taken with `date -u +%FT%TZ` / new Date().toISOString() when it began and when it ended.
 * steps: the times of its steps (a silence of more than PING_MINUTES between them left out, as between pings);
 * from/to: began and ended — the whole span counts.
 */
export type SessionLog = { steps?: string[]; from?: string; to?: string };

/** Longest stretch a log may give (a forgotten clock across the night isn't work). */
const MAX_LOG_MS = 12 * 3600000;

/**
 * The milliseconds an agent's log gives for the stretch since `since` (the clock's start, or the last record) up to `now` —
 * worked out here from the times it read, not taken from it. A time that can't be (unreadable, in the future) is refused.
 */
export function loggedMs(log: SessionLog | undefined, since: number, now: number): number {
  if (!log || (!log.steps?.length && !log.from && !log.to)) return 0;
  const when = (v: string, what: string) => {
    const ms = Date.parse(v);
    if (!Number.isFinite(ms)) throw new ValidationError(`${what} "${v}" isn't a time — ISO 8601, e.g. 2026-10-28T10:30:00Z (read it, e.g. date -u +%FT%TZ).`);
    if (ms > now + 60000) throw new ValidationError(`${what} ${v} is in the future.`);
    return ms;
  };
  if (log.steps?.length) {
    // From the clock's start: each step within PING_MINUTES of the one before counts the time between them.
    const steps = log.steps.map((v) => when(v, "A step's time")).filter((t) => t > since).sort((a, b) => a - b);
    let ms = 0;
    let last = since;
    for (const t of steps) {
      if (t - last <= PING_MS) ms += t - last;
      last = t;
    }
    return Math.min(ms, MAX_LOG_MS);
  }
  if (!log.from || !log.to) throw new ValidationError("A log needs both from and to (or steps).");
  const from = Math.max(when(log.from, "from"), since);
  const to = Math.min(when(log.to, "to"), now);
  if (to <= from) return 0;
  if (to - from > MAX_LOG_MS) throw new ValidationError(`From ${log.from} to ${log.to} is more than 12 hours — send the steps' times instead.`);
  return to - from;
}

/** The minutes of a stretch as a record takes them: at least one, whole minutes. */
const asMinutes = (ms: number) => Math.max(1, Math.round(ms / 60000));

/**
 * Starts the clock of `agent` on a todo — now. Running already on it: a sign of life (paused, it goes on). Running on another
 * todo: that one is stopped first and its time recorded ("switched to T-…"). What was stopped, if anything.
 */
export function clockIn(todoId: number, agent?: string | null, now = Date.now()): { since: string; resumed: boolean; switched: TimeRecord | null } {
  const who = agentOf(agent);
  const all = read();
  const mine = all[keyOf(todoId, who)];
  if (mine) {
    beat(mine, now, { resumeQuestion: true });
    write(all);
    return { since: mine.startedAt, resumed: true, switched: null };
  }
  let switched: TimeRecord | null = null;
  for (const [k, c] of Object.entries(all)) {
    if (c.agent.toLowerCase() !== who.toLowerCase()) continue;
    settle(c, now);
    const ms = ranMs(c, now);
    delete all[k];
    if (ms >= 30000) switched = addTodoTime({ todoId: c.todoId, minutes: asMinutes(ms), note: `switched to T-${todoId}`, by: c.agent, source: "agent", at: iso(now) });
  }
  all[keyOf(todoId, who)] = { todoId, agent: who, startedAt: iso(now), pausedAt: null, pausedMs: 0, lastPing: iso(now), silent: false };
  write(all);
  return { since: all[keyOf(todoId, who)].startedAt, resumed: false, switched };
}

/**
 * A sign of life from `agent` on a todo (todo_clock_ping): the clock is kept running — silent too long, it goes on from now
 * (the silence left out). A clock paused for a question to the user stays paused (todo_progress goes on). Null: no clock.
 */
export function clockPing(todoId: number, agent?: string | null, now = Date.now()): { minutes: number; resumedAfter: number | null; waiting: boolean } | null {
  const all = read();
  const k = find(all, todoId, agent);
  if (!k) return null;
  const c = all[k];
  settle(c, now);
  const silentFor = c.pausedAt && c.silent ? now - Date.parse(c.pausedAt) : null;
  beat(c, now);
  write(all);
  return { minutes: ranMs(c, now) / 60000, resumedAfter: silentFor === null ? null : Math.round(silentFor / 60000), waiting: !!c.pausedAt };
}

/**
 * Stops the clock of `agent` on a todo: the time it ran (pauses left out; silent too long: up to its last sign of life) as one
 * time record with `note` — unless `record` is false (finish_todo records it itself). The minutes, and the record; null when
 * no clock ran.
 */
export function clockOut(todoId: number, agent?: string | null, opts: { note?: string; record?: boolean; now?: number; log?: SessionLog } = {}): { minutes: number; record: TimeRecord | null; measured: number; logged: number } | null {
  const all = read();
  const k = find(all, todoId, agent);
  const c = k ? all[k] : undefined;
  if (!k || !c) return null;
  const now = opts.now ?? Date.now();
  settle(c, now);
  // What the clock heard — or, when it went quiet, what the agent's own log of the stretch gives (the more of the two).
  const measured = ranMs(c, now);
  const logged = loggedMs(opts.log, Date.parse(c.startedAt), now);
  const minutes = asMinutes(Math.max(measured, logged));
  delete all[k];
  write(all);
  const record = opts.record === false ? null : addTodoTime({ todoId, minutes, note: opts.note, by: c.agent, source: "agent", at: iso(now) });
  return { minutes, record, measured: Math.round(measured / 60000), logged: Math.round(logged / 60000) };
}

/**
 * A lap: the time since the clock started (or the last lap) recorded — silent too long: up to its last sign of life — and the
 * clock running on from now (a sign of life; waiting for the user, it stays paused). Null: no clock ran.
 */
export function clockLap(todoId: number, agent?: string | null, note?: string, now = Date.now(), log?: SessionLog): { minutes: number; record: TimeRecord } | null {
  const all = read();
  const k = find(all, todoId, agent);
  const c = k ? all[k] : undefined;
  if (!k || !c) return null;
  settle(c, now);
  const minutes = asMinutes(Math.max(ranMs(c, now), loggedMs(log, Date.parse(c.startedAt), now)));
  const record = addTodoTime({ todoId, minutes, note, by: c.agent, source: "agent", at: iso(now) });
  const waiting = !!c.pausedAt && !c.silent;
  all[k] = { ...c, startedAt: iso(now), pausedAt: waiting ? iso(now) : null, pausedMs: 0, lastPing: iso(now), silent: false };
  write(all);
  return { minutes, record };
}

/** Waiting for the user on a todo: every clock on it paused (goes on with clockResume / the next progress note). */
export function clockPause(todoId: number, now = Date.now()): number {
  const all = read();
  let n = 0;
  for (const c of Object.values(all))
    if (c.todoId === todoId) {
      settle(c, now);
      if (c.pausedAt) continue;
      c.pausedAt = iso(now);
      c.silent = false;
      n++;
    }
  if (n) write(all);
  return n;
}

/** Going on with a todo (a progress note): its clocks run again — paused for a question or silent — a sign of life. How many ran again. */
export function clockResume(todoId: number, now = Date.now()): number {
  const all = read();
  let n = 0;
  for (const c of Object.values(all))
    if (c.todoId === todoId) {
      settle(c, now);
      if (c.pausedAt) n++;
      beat(c, now, { resumeQuestion: true });
    }
  if (Object.values(all).some((c) => c.todoId === todoId)) write(all);
  return n;
}
