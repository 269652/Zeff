import { cellText, type DbSchema, type Row } from "../model";

/** A row as flows and lifecycles see it: id, title, its fields by name (texts, numbers, true/false). Client-safe. */
export function rowObject(schema: DbSchema, row: Pick<Row, "id" | "title" | "cells">): Record<string, unknown> {
  const out: Record<string, unknown> = { id: row.id, title: row.title };
  for (const p of schema.properties) {
    const v = row.cells[p.id];
    out[p.name] = p.type === "checkbox" ? v === true : p.type === "number" ? (typeof v === "number" ? v : null) : cellText(p, v) || null;
  }
  return out;
}
