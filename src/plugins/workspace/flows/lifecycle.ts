import { getSqlite } from "@/db";
import type { DbSchema, Lifecycle, Property, Row, Transition } from "../model";
import { holds } from "./expr";
import { rowObject } from "./rows";

/**
 * Lifecycles: a database's status (or select) field as a state machine. Its transitions say from which states a row may go to
 * which, under what condition (a guard over the row) and with which fields filled; a strict lifecycle lets the field change only so
 * — by its transition buttons, a flow, or a card dragged on the board when a transition fits. Every transition is kept (who, when,
 * from, to, a note) and runs the flows the lifecycle names: the transition's own, the state's leave and enter flows. Server only.
 */

function db() {
  const d = getSqlite();
  d.exec(`
    create table if not exists ws_transitions (id integer primary key autoincrement, row_id integer not null, db_id integer not null, transition text, from_state text, to_state text not null, by text, note text, at text not null);
    create index if not exists ws_transitions_row on ws_transitions (row_id, id);
  `);
  return d;
}

const nameOf = (field: Property | undefined, id: string | null | undefined) => (id ? (field?.options?.find((o) => o.id === id)?.name ?? id) : "");

/** Whether a transition can be taken from where the row is: its states, its guard, its fields. `why` says what stands in the way. */
export function canTake(schema: DbSchema, row: Pick<Row, "id" | "title" | "cells">, t: Transition): { ok: boolean; why?: string } {
  const lc = schema.lifecycle!;
  const field = schema.properties.find((p) => p.id === lc.field);
  const cur = (row.cells[lc.field] as string | undefined) ?? null;
  if (t.from.length && !(cur && t.from.includes(cur))) return { ok: false, why: `only from ${t.from.map((f) => nameOf(field, f)).join(", ")}` };
  if (cur === t.to) return { ok: false, why: `it is ${nameOf(field, t.to)} already` };
  const missing = (t.require ?? []).map((id) => schema.properties.find((p) => p.id === id)).filter((p): p is Property => !!p && (row.cells[p.id] === undefined || row.cells[p.id] === null || row.cells[p.id] === "" || (Array.isArray(row.cells[p.id]) && !(row.cells[p.id] as unknown[]).length)));
  if (missing.length) return { ok: false, why: `${missing.map((p) => p.name).join(", ")} must be filled first` };
  if (t.guard) {
    try {
      if (!holds(t.guard, { row: rowObject(schema, row) })) return { ok: false, why: `${t.guard} doesn't hold` };
    } catch (e) {
      return { ok: false, why: `its condition: ${(e as Error).message}` };
    }
  }
  return { ok: true };
}

/** The transitions of a row with whether each can be taken now. */
export function transitionsOf(schema: DbSchema, row: Pick<Row, "id" | "title" | "cells">): (Transition & { toName: string; ok: boolean; why?: string })[] {
  const lc = schema.lifecycle;
  if (!lc) return [];
  const field = schema.properties.find((p) => p.id === lc.field);
  const cur = (row.cells[lc.field] as string | undefined) ?? null;
  return lc.transitions.filter((t) => !t.from.length || (cur && t.from.includes(cur))).filter((t) => t.to !== cur).map((t) => ({ ...t, toName: nameOf(field, t.to), ...canTake(schema, row, t) }));
}

let taking: { row: number; transition: Transition } | null = null;

/**
 * The store asks before a cell changes (setCell): a lifecycle's field changing — inside a transition being taken, that one; else the
 * transition that fits (from the row's state to the new one); a strict lifecycle refuses a change no transition allows. Gives the
 * transition (null: none needed, or none fits a lifecycle that isn't strict).
 */
export function lifecycleGate(schema: DbSchema, row: Pick<Row, "id" | "title" | "cells">, propId: string, next: unknown): Transition | null {
  const lc = schema.lifecycle;
  if (!lc || lc.field !== propId) return null;
  const to = typeof next === "string" ? next : null;
  const cur = (row.cells[propId] as string | undefined) ?? null;
  if (to === cur) return null;
  if (taking && taking.row === row.id) return taking.transition;
  const fits = lc.transitions.filter((t) => t.to === to && (!t.from.length || (cur && t.from.includes(cur))));
  const ok = fits.find((t) => canTake(schema, row, t).ok);
  if (ok) return ok;
  // (A row without a state yet gets its first one freely: where it starts.)
  if (!lc.strict || !cur) return null;
  const field = schema.properties.find((p) => p.id === propId);
  if (!to) throw new Error(`“${field?.name}” follows its lifecycle — it can't be emptied.`);
  if (fits.length) throw new Error(`“${fits[0].name}”: ${canTake(schema, row, fits[0]).why}.`);
  throw new Error(`“${field?.name}” follows its lifecycle: there is no way from ${nameOf(field, cur) || "—"} to ${nameOf(field, to)}.`);
}

/** After the store changed the field: the transition kept and its flows started (in the background). */
export function afterLifecycleChange(v: { dbId: number; rowId: number; lifecycle: Lifecycle; transition: Transition | null; from: string | null; to: string | null; by?: string; note?: string }): void {
  if (!v.to) return;
  db().prepare("insert into ws_transitions (row_id, db_id, transition, from_state, to_state, by, note, at) values (?, ?, ?, ?, ?, ?, ?, ?)").run(v.rowId, v.dbId, v.transition?.id ?? null, v.from, v.to, v.by ?? (taking ? "transition" : "you"), v.note ?? null, new Date().toISOString());
  const flows = [v.from ? v.lifecycle.leave?.[v.from] : undefined, v.transition?.flow, v.lifecycle.enter?.[v.to]].filter((f): f is string => !!f);
  void (async () => {
    const { runFlow, fireFlowEvent } = await import("./engine");
    for (const name of flows) {
      try {
        await runFlow(name, { from: v.from, to: v.to, transition: v.transition?.name ?? null }, { row: v.rowId, trigger: { kind: "event", event: "transition" } });
      } catch (e) {
        console.error(`[lifecycle] ${name}: ${e instanceof Error ? e.message : e}`);
      }
    }
    await fireFlowEvent({ event: "transition", db: v.dbId, row: v.rowId, name: v.transition?.name, value: v.to ?? undefined });
  })().catch(() => undefined);
}

/** A row takes a transition (by its id or name): checked, the field set, the transition kept, its flows run. */
export async function takeTransition(rowId: number, which: string, opts: { by?: string; note?: string } = {}): Promise<{ id: number; from: string; to: string }> {
  const { getPage, rowsOf, setCell } = await import("../store");
  const page = getPage(rowId);
  if (!page?.dbId) throw new Error("No such row.");
  const d = rowsOf(page.dbId);
  const row = d?.rows.find((r) => r.id === rowId);
  const lc = d?.schema.lifecycle;
  if (!d || !row || !lc) throw new Error("This database has no lifecycle.");
  const w = which.trim().toLowerCase();
  const t = lc.transitions.find((x) => x.id === which || (x.name.toLowerCase() === w && (!x.from.length || x.from.includes(row.cells[lc.field] as string)))) ?? lc.transitions.find((x) => x.name.toLowerCase() === w);
  if (!t) throw new Error(`There is no transition “${which}”.`);
  const can = canTake(d.schema, row, t);
  if (!can.ok) throw new Error(`“${t.name}”: ${can.why}.`);
  const field = d.schema.properties.find((p) => p.id === lc.field);
  const from = nameOf(field, row.cells[lc.field] as string | undefined);
  taking = { row: rowId, transition: t };
  pendingNote = { by: opts.by, note: opts.note };
  try {
    setCell(rowId, lc.field, t.to);
  } finally {
    taking = null;
    pendingNote = null;
  }
  return { id: rowId, from, to: nameOf(field, t.to) };
}

let pendingNote: { by?: string; note?: string } | null = null;
/** Who takes the transition being taken (the store passes it on). */
export const transitionNote = () => pendingNote;

export type TransitionRecord = { id: number; transition: string | null; from: string | null; to: string; by: string | null; note: string | null; at: string };

/** A row's way through its lifecycle, newest first. */
export function rowHistory(rowId: number, limit = 50): TransitionRecord[] {
  return (db().prepare("select id, transition, from_state, to_state, by, note, at from ws_transitions where row_id = ? order by id desc limit ?").all(rowId, limit) as { id: number; transition: string | null; from_state: string | null; to_state: string; by: string | null; note: string | null; at: string }[]).map((r) => ({ id: r.id, transition: r.transition, from: r.from_state, to: r.to_state, by: r.by, note: r.note, at: r.at }));
}
