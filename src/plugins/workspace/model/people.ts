import type { DbSchema, Property, Row } from "./schema";
import { asArray, dateRange } from "./values";

// ---------------------------------------------------------------------------
// People: whose a row is — the chips to filter by, "mine"
// ---------------------------------------------------------------------------

const PERSON_NAMES = /^(assignee|zuständig|owner|person|bearbeiter|verantwortlich)$/i;

/** The property that says whose a row is: the one set, else the first person property, else a text one named Assignee (Zuständig …). */
export function personPropOf(schema: DbSchema): Property | undefined {
  const set = schema.personProp ? schema.properties.find((p) => p.id === schema.personProp) : undefined;
  return set ?? schema.properties.find((p) => p.type === "person") ?? schema.properties.find((p) => p.type === "text" && PERSON_NAMES.test(p.name.trim()));
}

/** A row's people as keys: person ids, or a name (any case, trimmed) — [] when nobody. */
export function personKeys(row: Row, p: Property): string[] {
  const v = row.cells[p.id];
  if (p.type === "person") return asArray(v).map((x) => String(Number(x))).filter((x) => x !== "0" && x !== "NaN");
  const name = typeof v === "string" ? v.trim().toLowerCase() : "";
  return name ? [name] : [];
}

/** The people on these rows with their counts (most first), nobody ("") last when there are rows without. `label`: a person id's name. */
export function personChips(rows: Row[], p: Property, label: (key: string) => string): { key: string; label: string; count: number }[] {
  const seen = new Map<string, { key: string; label: string; count: number }>();
  let nobody = 0;
  for (const r of rows) {
    const keys = personKeys(r, p);
    if (!keys.length) nobody++;
    for (const k of keys) {
      const c = seen.get(k) ?? { key: k, label: p.type === "person" ? label(k) : String(r.cells[p.id]).trim(), count: 0 };
      c.count++;
      seen.set(k, c);
    }
  }
  const list = [...seen.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return nobody ? [...list, { key: "", label: "", count: nobody }] : list;
}

/** The rows of any of these people ("" for nobody). */
export const filterByPeople = (rows: Row[], p: Property, keys: Set<string>): Row[] =>
  rows.filter((r) => {
    const own = personKeys(r, p);
    return own.length ? own.some((k) => keys.has(k)) : keys.has("");
  });

/** Your keys for a person property: your names (a text one), your person ids (a person one). */
export const mineKeys = (p: Property, me: { names: string[]; ids: number[] }): Set<string> =>
  new Set(p.type === "person" ? me.ids.map(String) : me.names.map((n) => n.trim().toLowerCase()).filter(Boolean));

/** The pinned rows (a note's pin: the property `pinned`) apart from the others — Keep's "Pinned" and "Others". */
export function splitPinned(rows: Row[]): { pinned: Row[]; others: Row[] } {
  const pinned = rows.filter((r) => r.cells.pinned === true);
  return { pinned, others: rows.filter((r) => r.cells.pinned !== true) };
}

/** A due date's alarm on a card (as Kanban's ⏰): past it "overdue", on the day "today" — none once the row is done. `today`: YYYY-MM-DD. */
export function dueTone(v: unknown, today: string, done: boolean): "overdue" | "today" | null {
  const r = done ? null : dateRange(v);
  if (!r) return null;
  const day = r.start.slice(0, 10);
  return day < today ? "overdue" : day === today ? "today" : null;
}

/**
 * Subtasks per parent row: the rows pointing at it through a relation to their own database (a
 * moved Kanban card's Parent) — done when their status is in the done group. By the parent's id.
 */
export function subtaskCounts(schema: DbSchema, rows: Row[], dbId: number): Record<number, { done: number; total: number }> {
  const parents = schema.properties.filter((p) => p.type === "relation" && p.relationDb === dbId && !p.backOf);
  const status = schema.properties.find((p) => p.type === "status");
  const out: Record<number, { done: number; total: number }> = {};
  for (const r of rows) {
    const done = !!status && status.options?.find((o) => o.id === r.cells[status.id])?.group === "done";
    for (const p of parents)
      for (const id of asArray(r.cells[p.id]).map(Number).filter((n) => n > 0 && n !== r.id)) {
        const c = (out[id] ??= { done: 0, total: 0 });
        c.total++;
        if (done) c.done++;
      }
  }
  return out;
}
