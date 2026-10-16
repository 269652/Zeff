import { t } from "@/lib/i18n/server";
import { newProperty, type DbSchema, type Property } from "./model";
import { addRow, getDatabase, getPage, rawRows, saveSchema, setCell } from "./store";

/**
 * Subtasks in any database (as Kanban had them): a row's subtasks are rows of the same database, linked to it by a
 * relation to itself ("Parent" — made with the first subtask; a moved Kanban board has it already). A new one starts in its
 * parent's status; one level — a subtask has none of its own; made a row of its own again by unlinking it.
 */

/** The relation a database's rows name their parent by (none: no subtasks yet). */
export const parentPropOf = (schema: DbSchema, dbId: number): Property | undefined => schema.properties.find((p) => p.type === "relation" && p.relationDb === dbId && !p.backOf);

const ids = (v: unknown): number[] => (Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v]).map(Number).filter((n) => n > 0);

/** The relation, made when there's none. */
function ensureParentProp(dbId: number): Property {
  const d = getDatabase(dbId)!;
  const known = parentPropOf(d.schema, dbId);
  if (known) return known;
  const p: Property = { ...newProperty(t("Parent"), "relation"), relationDb: dbId };
  saveSchema(dbId, { ...d.schema, properties: [...d.schema.properties, p] });
  return parentPropOf(getDatabase(dbId)!.schema, dbId)!;
}

/** A subtask of a row: a row of its database, linked to it, in its status. The new row's id. */
export function addSubtask(parentId: number, title: string): number {
  const parent = getPage(parentId);
  if (!parent?.dbId) throw new Error(t("Not a row of a database."));
  const dbId = parent.dbId;
  const d = getDatabase(dbId)!;
  const known = parentPropOf(d.schema, dbId);
  if (known && ids(parent.props[known.id]).length) throw new Error(t("A subtask can't have subtasks of its own."));
  const rel = ensureParentProp(dbId);
  const status = getDatabase(dbId)!.schema.properties.find((p) => p.type === "status");
  const cells: Record<string, unknown> = { [rel.id]: [parentId] };
  if (status && parent.props[status.id]) cells[status.id] = parent.props[status.id];
  return addRow(dbId, { title: title.trim() || t("Untitled"), cells });
}

export type Subtask = { id: number; title: string; done: boolean; status: string | null };

/** A row's subtasks, in the database's order — with whether each is done (its status in the done group). */
export function subtasksOf(parentId: number): Subtask[] {
  const dbId = getPage(parentId)?.dbId;
  if (!dbId) return [];
  const d = getDatabase(dbId)!;
  const rel = parentPropOf(d.schema, dbId);
  if (!rel) return [];
  const status = d.schema.properties.find((p) => p.type === "status");
  return rawRows(dbId)
    .filter((r) => ids(r.cells[rel.id]).includes(parentId))
    .map((r) => {
      const o = status?.options?.find((x) => x.id === r.cells[status.id]);
      return { id: r.id, title: r.title, done: o?.group === "done", status: o?.name ?? null };
    });
}

/** A subtask made a row of its own again. */
export function detachSubtask(rowId: number): void {
  const dbId = getPage(rowId)?.dbId;
  const rel = dbId ? parentPropOf(getDatabase(dbId)!.schema, dbId) : undefined;
  if (rel) setCell(rowId, rel.id, []);
}

/** A subtask done (its status the first done one) or open again (the first to-do one). */
export function setSubtaskDone(rowId: number, done: boolean): void {
  const dbId = getPage(rowId)?.dbId;
  const status = dbId ? getDatabase(dbId)!.schema.properties.find((p) => p.type === "status") : undefined;
  const o = status?.options?.find((x) => (x.group ?? "todo") === (done ? "done" : "todo"));
  if (status && o) setCell(rowId, status.id, o.id);
}
