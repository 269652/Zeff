import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { DataType, DbSchema, Row } from "./model";
import type { SourceRecord } from "./pipeline";

/**
 * Sources other plugins bring to the pipelines: a plugin contributes `{ id, label, read }` and any database can name it as a
 * source step ("ext" with its id) — filters, sets, joins, AI fields and views then work on it as on Jira's tickets. `pull` is
 * for a source that is a two-way view: before a run it is given the database's rows to write what was edited there back to
 * where the records come from (the source then reads them again, so the rows show what the owner holds). Server only.
 */
export type WorkspaceSource = {
  id: string;
  label: string;
  icon: string;
  /** What its records are (a database of them has this type from the start). */
  dataType?: DataType;
  /** One line: what the records are. */
  hint?: string;
  /** How many records it has (the data sources page). */
  count?: () => number;
  /** `label`: the step's own word - a database that follows only a part of the source (one list) names it. */
  read: (ctx?: { label?: string }) => SourceRecord[] | Promise<SourceRecord[]>;
  /** Its records, read at once: with this the source can be what a relation points at (a rollup over the booked time) — no database of it is made. */
  table?: () => SourceRecord[];
  /** Its columns (id, name, type) — known without a record (an empty source is still something to join). */
  columns?: { id: string; name: string; type: "text" | "date" | "number" | "checkbox" | "url" }[];
  /** Only for relations (`table`): it isn't offered as a database of its own. */
  relationOnly?: boolean;
  /** Its records are only read from where they live: a row cannot be made by hand in a database of it. */
  noNewRows?: boolean;
  /** Fields of its records that are the source's: on a row it brought, they aren't set by hand (rows of your own in the database are yours). */
  lockedFields?: string[];
  pull?: (dbId: number, rows: Row[], schema: DbSchema) => void | Promise<void>;
  /** A row of it deleted in the database: the record it came from goes too (`ref` as the record had it). Throws when it can't (a read-only record) - the row then stays. */
  remove?: (dbId: number, ref: string) => void | Promise<void>;
};

export const workspaceSources = extensionPoint<WorkspaceSource[]>("workspace.sources");

/** The sources of the installed plugins. */
export async function extSources(): Promise<WorkspaceSource[]> {
  await import("@/plugins/contributions");
  return workspaceSources.list().flatMap((c) => c.impl);
}
