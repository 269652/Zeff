import { AsyncLocalStorage } from "node:async_hooks";

/**
 * What a change (in the Workspace, by a todo done …) is made by, beyond who (activity.ts: you, the AI, a source): the action it is part of — a routine's run,
 * the AI's answer, a bulk edit (undo.ts names it) — and what follows from it inside, each step named after the one that set it off:
 * "Routine „Morgens“ › Auto: Erledigt am". None: a change by hand. Kept with each line of a row's history. Server only.
 */

const scope = new AsyncLocalStorage<string>();

/** The cause of what is written now — null: by hand. */
export const causeNow = (): string | null => scope.getStore() ?? null;

/** `fn` runs as caused by `label` — inside another cause, as what follows from it. */
export function withCause<T>(label: string, fn: () => T): T {
  const outer = causeNow();
  return scope.run(outer && outer !== label ? `${outer} › ${label}` : label, fn);
}
