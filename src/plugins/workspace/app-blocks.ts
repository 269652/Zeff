import { t } from "@/lib/i18n/server";
import { setFields } from "./api";
import { getDatabase, getPage, archivePage, addRow, rawRows, tree } from "./store";

/**
 * The blocks an app is laid out with — beside the modules of a detail view: a field of the row (edited in place), a list of the
 * rows of another database that belong to it (its relation), a button that does something to the row. What they read and do is
 * here; the editor's blocks (ui/app-blocks.tsx) call it.
 */

/** The database a row's page is about — the one whose fields the blocks pick from. */
export function layoutDatabase(pageId: number): number | null {
  return getPage(pageId)?.dbId ?? null;
}

export type LayoutChoices = {
  dbId: number | null;
  /** The fields of the row a field block can show. */
  properties: { id: string; name: string; type: string }[];
  /** The databases whose rows belong to this one's by a relation (a related list can show them). */
  related: { dbId: number; title: string; prop: string; propName: string }[];
};

/** What the blocks of a layout offer to pick: the database's fields, and the relations that lead to it. */
export function layoutChoices(pageId: number): LayoutChoices {
  const dbId = layoutDatabase(pageId);
  const d = dbId ? getDatabase(dbId) : null;
  if (!dbId || !d) return { dbId: null, properties: [], related: [] };
  const related = tree()
    .filter((x) => x.kind === "database")
    .flatMap((x) => (getDatabase(x.id)?.schema.properties ?? []).filter((p) => p.type === "relation" && p.relationDb === dbId && !p.backOf).map((p) => ({ dbId: x.id, title: x.title || t("Untitled"), prop: p.id, propName: p.name })));
  return {
    dbId,
    properties: [{ id: "title", name: d.schema.titleName, type: "title" }, ...d.schema.properties.filter((p) => !["srcref", "srcedited", "srcurl", "ticketkey", "noteref"].includes(p.id)).map((p) => ({ id: p.id, name: p.name, type: p.type }))],
    related,
  };
}

const idsOf = (v: unknown): number[] => (Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v]).map(Number).filter((n) => Number.isInteger(n) && n > 0);

export type RelatedRow = { id: number; title: string; details: string[] };

/** The rows of `dbId` that point to this row by `prop`, with a line or two of what they hold. */
export function relatedRows(rowId: number, dbId: number, prop: string): RelatedRow[] {
  const d = getDatabase(dbId);
  const p = d?.schema.properties.find((x) => x.id === prop);
  if (!d || !p || p.type !== "relation") return [];
  const show = d.schema.properties.filter((x) => ["status", "select", "date", "person", "checkbox"].includes(x.type) && x.id !== prop).slice(0, 2);
  return rawRows(dbId)
    .filter((r) => idsOf(r.cells[prop]).includes(rowId))
    .map((r) => ({
      id: r.id,
      title: r.title,
      details: show.flatMap((x) => {
        const v = r.cells[x.id];
        if (v === undefined || v === null || v === "" || v === false) return [];
        if (x.type === "status" || x.type === "select") return [x.options?.find((o) => o.id === v)?.name ?? ""].filter(Boolean);
        if (x.type === "checkbox") return [x.name];
        return [String(typeof v === "object" ? JSON.stringify(v) : v)];
      }),
    }));
}

/** A new row of `dbId`, pointing to this row. */
export function addRelatedRow(rowId: number, dbId: number, prop: string, title: string): number {
  const p = getDatabase(dbId)?.schema.properties.find((x) => x.id === prop);
  if (!p || p.type !== "relation") throw new Error(t("That is not a relation."));
  if (!title.trim()) throw new Error(t("A title, please."));
  return addRow(dbId, { title: title.trim(), cells: { [prop]: [rowId] } });
}

/**
 * A row from what was typed in a form block: only the fields the form has (by property id), a choice only among the options there
 * are, a title needed. The new row is told to the routines that listen (the store does).
 */
export function submitForm(dbId: number, fieldIds: string[], values: Record<string, string>): number {
  const d = getDatabase(dbId);
  if (!d) throw new Error(t("No such database."));
  const title = String(values.title ?? "").trim();
  if (!title) throw new Error(t("A {name}, please.", { name: d.schema.titleName }));
  const fields: Record<string, string> = {};
  for (const id of fieldIds) {
    const p = d.schema.properties.find((x) => x.id === id);
    const v = String(values[id] ?? "").trim();
    if (!p || !v) continue;
    if ((p.type === "select" || p.type === "status") && !p.options?.some((o) => o.name.toLowerCase() === v.toLowerCase())) throw new Error(t("“{value}” is not one of the choices of {field}.", { value: v, field: p.name }));
    fields[p.name] = v;
  }
  const id = addRow(dbId, { title });
  setFields(dbId, id, fields);
  return id;
}

/** What a button does: set a field of the row, move it to the trash, or read the database's sources again. */
export const BUTTON_KINDS = ["set", "trash", "refresh"] as const;
export type ButtonSpec = { action: (typeof BUTTON_KINDS)[number]; prop?: string; value?: string };

/** A button pressed on a row. What it did, in words. */
export async function runRowButton(rowId: number, spec: ButtonSpec): Promise<{ message: string; undo?: { prop: string; value: string } }> {
  const page = getPage(rowId);
  if (!page?.dbId) throw new Error(t("This is not a row of a database."));
  const d = getDatabase(page.dbId);
  if (!d) throw new Error(t("No such database."));
  if (spec.action === "set") {
    const p = d.schema.properties.find((x) => x.id === spec.prop);
    if (!p && spec.prop !== "title") throw new Error(t("Pick the field the button sets."));
    const name = p?.name ?? d.schema.titleName;
    setFields(page.dbId, rowId, { [name]: String(spec.value ?? "") });
    return { message: t("{field} set to “{value}”.", { field: name, value: String(spec.value ?? "") }) };
  }
  if (spec.action === "trash") {
    archivePage(rowId);
    return { message: t("Moved to the trash.") };
  }
  if (spec.action === "refresh") {
    (await import("./pipeline")).startPipeline(page.dbId, { ai: false });
    return { message: t("Reading the sources again — the rows follow.") };
  }
  throw new Error(t("Unknown action."));
}
