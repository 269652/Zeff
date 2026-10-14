/**
 * All actions the plugins contribute, gathered from their folders — one place for their buttons, labels, notes, the
 * validation of what an AI proposes and the AI's dictionary. Which of them can run now is the
 * installed plugins' business (opAvailable on the server). Client-safe.
 */
import type { TodoOp } from "@/lib/boards/shared";
import { pluginById } from "../catalog";
import { ACTION_LISTS } from "../actions.generated";
import type { ActionSpec, ActionType, CleanContext } from "./types";

/** Every plugin's actions (the `*_ACTIONS` lists in their folders, see actions.generated.ts), in the AI dictionary's order: by their plugin's `actionsOrder`. */
export const ACTIONS: ActionSpec[] = (ACTION_LISTS.flat() as unknown as ActionSpec[])
  .map((a, i) => ({ a, i, rank: (a.plugin && pluginById(a.plugin)?.actionsOrder) || 1000 }))
  .sort((x, y) => x.rank - y.rank || x.i - y.i)
  .map((x) => x.a);

const BY_TYPE = new Map(ACTIONS.map((a) => [a.type, a]));

/** An operation's action (its plugin, label, how it's shown and run). */
export const actionOf = <T extends ActionType>(type: T) => BY_TYPE.get(type) as unknown as ActionSpec<T>;

/** The actions an AI may propose (those with an offer), in the catalog's order. */
export const OFFERED_ACTIONS = ACTIONS.filter((a) => a.offer);

/** What an AI handed over as operations, cleaned by each action's own rules — the complete ones, at most six. */
export function cleanActions(raw: unknown, ctx: CleanContext): TodoOp[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      const a = typeof o.type === "string" ? BY_TYPE.get(o.type as ActionType) : undefined;
      const op = a?.clean(o, ctx);
      return op ? [op as TodoOp] : [];
    })
    .slice(0, 6);
}

/** Whether an operation opens in your browser (a pre-filled window) — and where. */
export const actionHref = (op: TodoOp): string | null => {
  const a = actionOf(op.type);
  return a.href ? (a.href as (o: TodoOp) => string)(op) : null;
};
