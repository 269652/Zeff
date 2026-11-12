/**
 * A kind of chat may keep its conversation where you can change it (Learn: each lesson's messages in a Workspace database).
 * Its live Claude session only knows what was said in it — so the chat's guard says, before the next message, whether the
 * session goes on (resumed as always) or a fresh one starts with the stored conversation in its prompt; and it hears when a
 * turn (or a run) ended, to keep its copy up to date. Registered by the plugin's server module, by the chat todo's source.
 * Server only.
 */
import { getTodo } from "@/lib/todos/store";
import { getRun } from "./store";

export type ConversationGuard = {
  /** Before the next message: go on in the session, or start a fresh one with this context (the stored conversation). */
  continuity(todoId: number): { fresh: false } | { fresh: true; context: string };
  /** A fresh session was started with the context. */
  started(todoId: number): void;
  /** A turn of one of its runs ended, or the run did. */
  turn?(runId: number): void;
};

const g = globalThis as { __zeffConversationGuards?: Map<string, ConversationGuard> };
const guards = (g.__zeffConversationGuards ??= new Map());

export const registerConversationGuard = (source: string, guard: ConversationGuard): void => void guards.set(source, guard);

/** A guard for every chat whose source starts so (the chats an external plugin brings: "Zeff-Chat:ext."). */
const byPrefix = ((g as { __zeffConversationGuardPrefixes?: Map<string, (source: string) => ConversationGuard | undefined> }).__zeffConversationGuardPrefixes ??= new Map());
export const registerConversationGuardFor = (prefix: string, make: (source: string) => ConversationGuard | undefined): void => void byPrefix.set(prefix, make);

/** The plugins' server modules (where the guards are registered) — loaded once. */
const loaded = () => import("@/plugins/contributions").catch(() => undefined);

const guardOf = (todoId: number | null | undefined): ConversationGuard | undefined => {
  const src = todoId ? getTodo(todoId)?.source : undefined;
  if (!src) return undefined;
  const exact = guards.get(src);
  if (exact) return exact;
  for (const [prefix, make] of byPrefix) if (src.startsWith(prefix)) return make(src);
  return undefined;
};

/** The context a chat's next run must start a fresh session with — null: it goes on in its session. */
export function freshContext(todoId: number): string | null {
  const gd = guardOf(todoId);
  if (!gd) return null;
  try {
    const c = gd.continuity(todoId);
    return c.fresh ? c.context : null;
  } catch (e) {
    console.error(`[work] the conversation guard of todo ${todoId} failed`, e);
    return null;
  }
}

export const freshStarted = (todoId: number): void => guardOf(todoId)?.started(todoId);

/** A turn of a run ended (or the run): its chat's guard follows. */
export async function conversationTurn(runId: number): Promise<void> {
  try {
    await loaded();
    const r = getRun(runId);
    guardOf(r?.todoId)?.turn?.(runId);
  } catch (e) {
    console.error(`[work] following the conversation of run ${runId} failed`, e);
  }
}

/**
 * A message for a running live session — unless its chat's conversation must start afresh: then the session is closed and a
 * new run takes the message (it starts a fresh session with the stored conversation once the old one has ended). The new
 * run's id; null: the message goes into the session as always.
 */
export async function freshInstead(runId: number, text: string): Promise<number | null> {
  await loaded();
  const r = getRun(runId);
  if (!r || !guardOf(r.todoId) || freshContext(r.todoId) === null) return null;
  const { liveDriverOf } = await import("./live-driver");
  const d = liveDriverOf(runId);
  if (d?.view(runId)) await d.close(runId).catch((e) => console.error(`[work] closing ${runId} for a fresh session failed`, e));
  const { dispatchTodo } = await import("./runner");
  return dispatchTodo(r.todoId, { instruction: text, continueRun: runId, conversation: true, session: { permissionMode: "default" } }).id;
}
