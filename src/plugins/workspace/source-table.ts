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

/** What an agent needs to join a database with the sources: their ids and properties, and how (relation.source + relation.match). */
export function relationSourceHelp(): string {
  const lines = relationSources().map((s) => {
    const props = sourceTable(s.id)?.schema.properties.map((p) => `${p.name} (${p.type})`).join(", ") ?? "";
    return `- ${s.id} (${s.label}): ${props}`;
  });
  return [
    "Sources a database can join (a relation with `source`, matched by value, then a rollup over it — nothing is copied, it is live):",
    ...lines,
    'Example: on a database of tickets (title = key): relation {source: "mrs", match: {from: "title", to: "Ticket"}}, then a rollup of it (property "title", fn count, filter State is opened) = open merge requests per ticket; a rollup of jira-comments with property Date and fn latest = the last comment, and a formula dateBetween(prop("Last comment"), today(), "days") = days since.',
  ].join("\n");
}

/** Whether a source with a table is there (its plugin installed) — without reading its rows. */
export const hasSource = (id: string): boolean => !!impl(id);

export function sourceTable(id: string): SourceTable | null {
  const s = impl(id);
  if (!s?.table) return null;
  const props = new Map<string, Property>();
  for (const c of s.columns ?? []) props.set(c.id, { id: c.id, name: c.name, type: c.type });
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
