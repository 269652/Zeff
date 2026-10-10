/**
 * All actions the plugins contribute, gathered — one place for their buttons, labels, notes, the
 * validation of what an AI proposes and the AI's dictionary. Which of them can run now is the
 * installed plugins' business (opAvailable on the server). Client-safe.
 */
import type { TodoOp } from "@/lib/boards/shared";
import { GITLAB_ACTIONS } from "../gitlab/actions";
import { JIRA_ACTIONS } from "../jira/actions";
import { OUTLOOK_CALENDAR_ACTIONS, OUTLOOK_MAIL_ACTIONS } from "../outlook/actions";
import { TEAMS_ACTIONS } from "../teams/actions";
import { WORK_ACTIONS } from "../work/actions";
import type { ActionSpec, ActionType, CleanContext } from "./types";

export const ACTIONS: ActionSpec[] = [...JIRA_ACTIONS, ...GITLAB_ACTIONS, ...TEAMS_ACTIONS, ...OUTLOOK_MAIL_ACTIONS, ...OUTLOOK_CALENDAR_ACTIONS, ...WORK_ACTIONS] as unknown as ActionSpec[];

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
