/**
 * A strict state machine for everything that can be started and then runs: a sync, a briefing step, an
 * agent run. Its states and the transitions between them are the whole truth — a button asks the machine
 * whether it may fire (`canStart`), and an event that does not belong to the state it is in is refused
 * (nothing changes), so a button cannot be pressed twice and a late answer cannot turn a running thing
 * back into an idle one. Pure and client-safe (the keys are whatever the element is called).
 *
 *   idle ──click──▶ starting ──started──▶ running ──finished──▶ idle
 *                      │  │                  │
 *                      │  └──refused──▶ idle  └──stop──▶ stopping ──finished──▶ idle
 *                      └──settled──▶ idle (it finished before it was ever seen running)
 *   (idle ──started──▶ running: somebody else started it — the scheduler, another tab, the briefing)
 */

export type RunState = "idle" | "starting" | "running" | "stopping";
export type RunEvent =
  | "click" // the user pressed the button
  | "started" // the server says it is running
  | "refused" // the server did not start it (already running, not installed …)
  | "settled" // accepted, but finished before it was seen running (an instant step)
  | "stop" // the user pressed stop
  | "finished"; // the server says it is not running any more

/** Every transition there is: state → event → next state. What isn't here is not allowed. */
export const RUN_TRANSITIONS: Record<RunState, Partial<Record<RunEvent, RunState>>> = {
  idle: { click: "starting", started: "running" },
  starting: { started: "running", refused: "idle", settled: "idle" },
  running: { stop: "stopping", finished: "idle" },
  stopping: { finished: "idle", started: "running" },
};

/** The next state, or null when the event doesn't belong to this state (refused: nothing changes). */
export const nextRunState = (state: RunState, event: RunEvent): RunState | null => RUN_TRANSITIONS[state][event] ?? null;

/** A start button may fire only from idle. */
export const canStart = (state: RunState): boolean => nextRunState(state, "click") !== null;
/** A stop button may fire only while it runs. */
export const canStop = (state: RunState): boolean => nextRunState(state, "stop") !== null;
/** Shown as busy: a spinner, no second press. */
export const isBusy = (state: RunState): boolean => state !== "idle";

/** Many elements at once (the sync menu's steps), each in its own state, all through the same table. */
export class RunMachines {
  private states = new Map<string, RunState>();
  /** Polls in a row that saw an accepted start not running (it may have finished already). */
  private quiet = new Map<string, number>();

  state(key: string): RunState {
    return this.states.get(key) ?? "idle";
  }

  /** Fire an event: true when it was allowed (and the state moved). */
  send(key: string, event: RunEvent): boolean {
    const next = nextRunState(this.state(key), event);
    if (next === null) return false;
    if (next === "idle") this.states.delete(key);
    else this.states.set(key, next);
    if (next !== "starting") this.quiet.delete(key);
    return true;
  }

  /**
   * What the server says now about one element. Running: it started (if it wasn't known to). Not running:
   * a running one finished; a just-accepted one that stays unseen for two polls settled (it was quick).
   */
  observe(key: string, running: boolean): void {
    const s = this.state(key);
    if (running) {
      if (s !== "running") this.send(key, "started");
      return;
    }
    if (s === "running" || s === "stopping") this.send(key, "finished");
    else if (s === "starting" && this.quiet.has(key)) {
      const n = (this.quiet.get(key) ?? 0) + 1;
      this.quiet.set(key, n);
      if (n >= 2) this.send(key, "settled");
    }
  }

  /** The server accepted the start: from now on a poll that doesn't see it running counts toward "settled". */
  accepted(key: string): void {
    if (this.state(key) === "starting") this.quiet.set(key, 0);
  }

  /** Whether any element is between its click and the server's answer (nothing else is started meanwhile). */
  anyStarting(): boolean {
    return [...this.states.values()].includes("starting");
  }

  /** Whether any of the keys is busy. */
  anyBusy(): boolean {
    return this.states.size > 0;
  }
}
