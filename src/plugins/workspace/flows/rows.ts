import { cellText, type DbSchema, type Row } from "../model";

/** A row as flows and lifecycles see it: id, title, its fields by name (texts, numbers, true/false). Client-safe. */
/** A row as code needs it (db.query raw): a relation's row ids, a date as written, a choice's option name, a checkbox true/false. */
export function rawRowObject(schema: DbSchema, row: Pick<Row, "id" | "title" | "cells"> & { icon?: string | null }): Record<string, unknown> {
  const out: Record<string, unknown> = { id: row.id, title: row.title, ...(row.icon ? { icon: row.icon } : {}) };
  for (const p of schema.properties) {
    const v = row.cells[p.id];
    const option = (x: unknown) => p.options?.find((o) => o.id === x)?.name ?? null;
    out[p.name] =
      p.type === "checkbox" ? v === true
      : p.type === "select" || p.type === "status" ? option(v)
      : p.type === "multi_select" ? (Array.isArray(v) ? v.map(option).filter((x) => x !== null) : [])
      : v ?? null;
  }
  return out;
}

export function rowObject(schema: DbSchema, row: Pick<Row, "id" | "title" | "cells">): Record<string, unknown> {
  const out: Record<string, unknown> = { id: row.id, title: row.title };
  for (const p of schema.properties) {
    const v = row.cells[p.id];
    out[p.name] = p.type === "checkbox" ? v === true : p.type === "number" ? (typeof v === "number" ? v : null) : cellText(p, v) || null;
  }
  return out;
}
