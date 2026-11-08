/**
 * The phone companion's side of Zeff (launcher/lib/companion): what the phone shows of your todos, and the
 * changes it sends — ticked off live while it's connected at home, or queued while it was away and sent all
 * at once when it's back on the Wi-Fi. Each change has an id the phone made; one already applied is not
 * applied again (a queue sent twice after a dropped connection does nothing twice).
 */
import { getPref, setPref } from "@/lib/prefs";
import type { TodoView } from "@/lib/todos/shared";

/** A todo as the phone keeps it. */
export type CompanionTodo = {
  id: number;
  text: string;
  ticket: string;
  due: string | null;
  status: TodoView["status"];
  owner: TodoView["owner"];
  flagged: boolean;
  deferred: boolean;
  source: string | null;
  updatedAt: string;
  doneAt: string | null;
};

/** A change from the phone: `id` its own (unique), `at` when you made it there. */
export type CompanionOp =
  | { id: string; at: string; kind: "status"; todoId: number; status: TodoView["status"] }
  | { id: string; at: string; kind: "flag"; todoId: number; flagged: boolean }
  | { id: string; at: string; kind: "note"; todoId: number; text: string };

export type CompanionResult = { id: string; ok: boolean; skipped?: string; error?: string };

/**
 * An account the phone can switch to: `prefix` is the route the launcher asks it under ("/privat"; "" without the
 * Accounts plugin). `locked`: Zeff's lock guards it (Settings → Lock) — the phone sees that it's there, not its todos.
 */
export type CompanionAccount = { id: string; name: string; color: string; prefix: string; locked: boolean; current: boolean };

/** The accounts for the phone's switcher (not the demo). */
export async function companionAccounts(): Promise<CompanionAccount[]> {
  const { listAccounts, accountsInstalled, currentAccountId } = await import("@/db/accounts");
  const { slugOf } = await import("@/lib/account-routes");
  const { readConfig, lockOpenFor } = await import("@/lib/lock/shared");
  const lock = readConfig();
  const installed = accountsInstalled();
  const current = currentAccountId();
  return listAccounts()
    // (`demo`: the demo account, where there is one — read loosely, an Account may not have the field.)
    .filter((a) => !(a as { demo?: boolean }).demo && (installed || a.id === current))
    .map((a) => ({ id: a.id, name: a.name, color: a.color, prefix: installed ? `/${slugOf(a)}` : "", locked: !!lock && !lockOpenFor(lock, a.id), current: a.id === current }));
}

/** Whether the lock guards the account this request is for (then the companion shows nothing of it and changes nothing). */
export async function companionLocked(): Promise<boolean> {
  return (await companionAccounts()).find((a) => a.current)?.locked ?? false;
}

const APPLIED_KEY = "companion:applied";
const KEEP_APPLIED = 5000;

const toCompanion = (t: TodoView): CompanionTodo => ({
  id: t.id,
  text: t.text,
  ticket: t.ticket,
  due: t.due,
  status: t.status,
  owner: t.owner,
  flagged: !!t.flaggedAt,
  deferred: !!t.deferredAt,
  source: t.source,
  updatedAt: t.updatedAt,
  doneAt: t.doneAt,
});

/** Your todos for the phone: the open ones and those closed in the last `days` days (so a tick stays visible). Not the workers'. */
export async function companionSnapshot(days = 3): Promise<{ at: string; account: string; accounts: CompanionAccount[]; todos: CompanionTodo[] }> {
  const accounts = await companionAccounts();
  const account = accounts.find((a) => a.current)?.id ?? "default";
  const { listTodos } = await import("@/lib/todos/store");
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const todos = listTodos({ status: "all", openOrDoneSince: since, byWorker: false }).filter((t) => t.status !== "dismissed" || (t.doneAt ?? "") >= since);
  return { at: new Date().toISOString(), account, accounts, todos: todos.map(toCompanion) };
}

/** Whether a value is a change we know (the phone's data is checked like any other request's). */
export function isCompanionOp(v: unknown): v is CompanionOp {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id || o.id.length > 100 || typeof o.at !== "string" || !Number.isInteger(o.todoId)) return false;
  if (o.kind === "status") return o.status === "open" || o.status === "done" || o.status === "dismissed";
  if (o.kind === "flag") return typeof o.flagged === "boolean";
  if (o.kind === "note") return typeof o.text === "string" && o.text.length <= 4000;
  return false;
}

/**
 * Apply the phone's changes in the order they were made, each once. One that no longer fits is skipped and
 * says why (the todo is gone; it's already in that state — done on the PC meanwhile). Everything is yours
 * ("you" in the todo's history), like a tick on the PC.
 */
export async function applyCompanionOps(ops: CompanionOp[]): Promise<CompanionResult[]> {
  const store = await import("@/lib/todos/store");
  const { attributed } = await import("@/lib/todos/activity");
  const applied = getPref<string[]>(APPLIED_KEY, []);
  const seen = new Set(applied);
  const results: CompanionResult[] = [];
  for (const op of [...ops].sort((a, b) => a.at.localeCompare(b.at))) {
    if (seen.has(op.id)) {
      results.push({ id: op.id, ok: true, skipped: "already applied" });
      continue;
    }
    try {
      const todo = store.getTodo(op.todoId);
      if (!todo) results.push({ id: op.id, ok: true, skipped: "todo gone" });
      else if (op.kind === "status") {
        if (todo.status === op.status) results.push({ id: op.id, ok: true, skipped: `already ${op.status}` });
        else {
          attributed("you", () => store.setTodoStatus(op.todoId, op.status, op.status === "open" ? null : undefined));
          results.push({ id: op.id, ok: true });
        }
      } else if (op.kind === "flag") {
        if (!!todo.flaggedAt === op.flagged) results.push({ id: op.id, ok: true, skipped: "unchanged" });
        else {
          store.setTodoFlagged(op.todoId, op.flagged);
          results.push({ id: op.id, ok: true });
        }
      } else {
        store.addTodoUserNote(op.todoId, op.text);
        results.push({ id: op.id, ok: true });
      }
      seen.add(op.id);
      applied.push(op.id);
    } catch (err) {
      results.push({ id: op.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  setPref(APPLIED_KEY, applied.slice(-KEEP_APPLIED));
  return results;
}
