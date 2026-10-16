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
  read: () => SourceRecord[] | Promise<SourceRecord[]>;
  pull?: (dbId: number, rows: Row[], schema: DbSchema) => void | Promise<void>;
};

export const workspaceSources = extensionPoint<WorkspaceSource[]>("workspace.sources");

/** The sources of the installed plugins. */
export async function extSources(): Promise<WorkspaceSource[]> {
  await import("@/plugins/contributions");
  return workspaceSources.list().flatMap((c) => c.impl);
}
