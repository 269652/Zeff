"use server";

import { t } from "@/lib/i18n/server";
import * as store from "../store";
import { run } from "./shared";

// ---------------------------------------------------------------------------
// The detail view's blocks: what happened to a row, and everything that belongs to it
// ---------------------------------------------------------------------------

/** A change from the history undone: the cell gets its old value (the undo is logged like any change). */
export async function restoreChangeAction(lineId: number) {
  return run(async () => {
    const { restoreChange } = await import("../activity");
    return await restoreChange(Number(lineId));
  });
}

/** The lines of what happened to a page or row (who changed what), newest first. */
export async function activityAction(pageId: number, limit = 30) {
  return run(async () => {
    const { activityOf } = await import("../activity");
    const p = store.getPage(Number(pageId));
    if (!p) throw new Error(t("This page is gone."));
    return { lines: activityOf(p.id, limit), title: p.title };
  });
}

/** Everything Zeff knows that belongs to a page or row: linked pages, related rows, todos, tickets, pages about the same. */
export async function belongsAction(pageId: number) {
  return run(async () => ({ belongs: await (await import("../belongs")).belongsTo(Number(pageId)) }));
}

/** The search box over a database: its rows whose pages say what was typed (a document's text, a mail's body) — the cells it searches itself. */
export async function rowsMatchingAction(dbId: number, q: string): Promise<number[]> {
  return (await import("../row-search")).rowsMatching(Number(dbId), String(q ?? "").slice(0, 300));
}

/** A day's entry of a daily list's log as a table like the list (day-log.ts) — null: the row is no such entry. */
export async function dayEntryAction(rowId: number) {
  return run(async () => ({ table: (await import("../day-log")).dayEntryTable(Number(rowId)) }));
}

/**
 * A routine tried without changing anything (automation.ts dryRunRoutine): what it would set, make, move to the trash and do. A routine
 * set off by a database's events is tried on that database's newest row (the row it would have in hand); `row` picks another.
 */
export async function dryRunRoutineAction(pageId: number, row?: number) {
  return run(async () => {
    const { dryRunRoutine } = await import("../automation");
    const { getRoutine } = await import("../routines");
    const routine = getRoutine(Number(pageId));
    if (routine?.kind !== "automation") throw new Error(t("Only an automation can be tried — an agent's work is never the same twice."));
    const db = routine.triggers.find((x): x is Extract<typeof x, { kind: "event" }> => x.kind === "event" && typeof x.db === "number")?.db;
    const sample = row ?? (db ? store.rawRows(db).filter((r) => !store.getPage(r.id)?.archivedAt).at(-1)?.id : undefined);
    const plan = await dryRunRoutine(Number(pageId), { row: sample });
    return { plan, row: sample ? { id: sample, title: store.getPage(sample)?.title ?? "" } : null };
  });
}

/** A button field pressed (row-button.ts): its routine runs with the row in hand. */
export async function pressButtonAction(rowId: number, propId: string) {
  return run(async () => (await import("../row-button")).pressButton(Number(rowId), String(propId)));
}

/**
 * What hangs together with a row or a todo (lib/boards/todo-settle.ts): the things it stands for — what settled them, what "paid"
 * pays — and the open todos that would settle them.
 */
export async function linksAction(target: { rowId: number } | { todoId: number }) {
  return run(async () => {
    const s = await import("@/lib/boards/todo-settle");
    if ("todoId" in target) return s.linksOf({ todoId: Number(target.todoId) });
    const refs = s.refsOfRow(Number(target.rowId));
    if (!refs.length) return { things: [], todos: [] };
    const { listTodos } = await import("@/lib/boards/store");
    return s.linksOf({ refs }, { openTodos: listTodos({ status: "open" }) });
  });
}

/** "Paid" said by hand on a thing (a debt, a case): settled as a proof of its own. Its key, to take it back. */
export async function markPaidAction(ref: string, amount: number | null) {
  return run(async () => {
    const s = await import("@/lib/boards/todo-settle");
    const n = amount != null && Number.isFinite(Number(amount)) && Number(amount) > 0 ? Math.round(Number(amount) * 100) / 100 : null;
    const r = s.settleByHand(String(ref), n, t("by hand"));
    if (!r.settled.length) throw new Error(t("Nothing to pay there."));
    return r;
  });
}

/** "Paid" by hand taken back. */
export async function undoPaidAction(key: string) {
  return run(async () => {
    if (!String(key).startsWith("hand:")) throw new Error(t("Nothing to undo."));
    return { back: (await import("@/lib/boards/todo-settle")).unsettle(String(key), t("by hand")) };
  });
}

/** A rules database tried (rules.ts tryRulesDatabase): per rule, the records it would hit — nothing written. */
export async function tryRulesAction(dbId: number) {
  return run(async () => (await import("../rules")).tryRulesDatabase(Number(dbId)));
}

/** A payment released from a thing (a wrong match — lib/boards/todo-settle.ts releasePayment): its figures back. */
export async function releasePaymentAction(paymentId: number, ref: string) {
  return run(async () => {
    (await import("@/lib/boards/todo-settle")).releasePayment(Number(paymentId), String(ref));
    return {};
  });
}

/** A table shared for formulas under a name (other tables' cells read it: Kosten!B2), or not any more (null). */
export async function setTableShareAction(dbId: number, name: string | null) {
  return run(() => {
    store.setTableShare(Number(dbId), name === null ? null : String(name));
    return {};
  });
}
