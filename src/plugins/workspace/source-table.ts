import "@/plugins/contributions";
import { normalizeSchema, type DbSchema, type Property, type Row } from "./model";
import { workspaceSources } from "./source-point";

/**
 * A source of a plugin as a table in memory — what a relation can point at without a database made of it: the booked time, say.
 * Its records are the rows (their title, and the typed fields as properties); nothing is stored. Server only.
 */
export type SourceTable = { schema: DbSchema; rows: Row[] };

const impl = (id: string) => workspaceSources.list().flatMap((c) => c.impl).find((s) => s.id === id && s.table);

/** The sources a relation can point at. */
export function relationSources(): { id: string; label: string; icon: string }[] {
  return workspaceSources.list().flatMap((c) => c.impl).filter((s) => s.table).map((s) => ({ id: s.id, label: s.label, icon: s.icon }));
}

export function sourceTable(id: string): SourceTable | null {
  const s = impl(id);
  if (!s?.table) return null;
  const props = new Map<string, Property>();
  const records = s.table();
  for (const r of records) for (const f of r.typed ?? []) if (!props.has(f.id)) props.set(f.id, { id: f.id, name: f.name, type: f.type === "select" ? "text" : f.type });
  const now = new Date().toISOString();
  const rows: Row[] = records.map((r, i) => ({
    id: i + 1,
    title: r.title,
    icon: "",
    cells: Object.fromEntries((r.typed ?? []).map((f) => [f.id, f.value])),
    createdAt: r.updatedAt ?? now,
    updatedAt: r.updatedAt ?? now,
  }));
  return { schema: normalizeSchema({ titleName: s.label, properties: [...props.values()], views: [] }), rows };
}
