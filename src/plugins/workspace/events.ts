import { AsyncLocalStorage } from "node:async_hooks";

/**
 * What happens in the Workspace's databases, told to the routines that listen (routine-triggers.ts): a row added, a cell changed. The
 * store only says it; nothing here depends on the routines (they are loaded when there is something to tell). While a pipeline writes
 * its rows, or a routine runs, the rows' own events stay quiet: the pipeline tells once when it is through, and a routine's changes
 * never set routines off again (no loops). Server only.
 */
export type RowEvent = "row.added" | "row.changed" | "row.removed";
export type RowEventInfo = { db: number; row: number; field?: string; /** The new value of the cell, as text (row.changed). */ value?: string };

const quietScope = new AsyncLocalStorage<boolean>();

/** `fn` runs with the rows' events suppressed. */
export const quietly = <T>(fn: () => T): T => quietScope.run(true, fn);
export const isQuiet = (): boolean => quietScope.getStore() === true;

const sourceScope = new AsyncLocalStorage<boolean>();

/** `fn` runs as a source writing its own records: the one thing allowed to add rows to a database that only shows a source. */
export const viaSource = <T>(fn: () => T): T => sourceScope.run(true, fn);
export const isViaSource = (): boolean => sourceScope.getStore() === true;

/** Tell the routines (in the background; a failure there never touches the store). */
export function emitRowEvent(event: RowEvent, info: RowEventInfo): void {
  if (isQuiet()) return;
  void import("./routine-triggers").then((m) => m.fireRoutineEvent(event, info)).catch(() => undefined);
  // (The flows that listen too — flows/engine.ts.)
  void import("./flows/engine").then((m) => m.fireFlowEvent({ event, db: info.db, row: info.row, field: info.field, value: info.value })).catch(() => undefined);
}
