import { getSqlite } from "@/db";
import { isInstalled } from "@/plugins/state";
import type { Doc, DocNode } from "./doc";
import type { DataType } from "./model";
import { getPref, setPref } from "@/lib/prefs";
import { removeSystemPages } from "@/lib/prompts/system-pages";
import { archivePage, getDatabase, getPage, subtree, updatePage } from "./store";

/**
 * A custom view of a row: a plugin brings ONE view for the rows of a database of a type (the person's page for the people
 * database). It is a block of the row's own page (`rowView`) — the rest of the page is free text and blocks. Not installed, the
 * block shows nothing. Made once for each row: a page of such a row starts with it (the row's own text stays after it).
 */
export type RowView = { id: string; plugin: string; dataType: DataType; label: string };

export const ROW_VIEWS: RowView[] = [
  { id: "person", plugin: "people", dataType: "people", label: "Person" },
  { id: "case", plugin: "cases", dataType: "cases", label: "Case" },
];

/** The custom view the rows of a database of this type have now (its plugin installed). */
export const rowViewOf = (dataType: DataType | undefined): RowView | undefined => (dataType ? ROW_VIEWS.find((v) => v.dataType === dataType && isInstalled(v.plugin)) : undefined);

const has = (doc: Doc): boolean => (doc.content ?? []).some((n) => n.type === "rowView");

/** A row's page made to start with its database's custom view — when it has one and the page doesn't. True: it was written. */
export function ensureRowView(rowId: number): boolean {
  const row = getPage(rowId);
  const db = row?.dbId ? getDatabase(row.dbId) : null;
  if (!row || !db || row.archivedAt || !rowViewOf(db.schema.dataType) || has(row.content)) return false;
  // (An empty page: just the block — not an empty paragraph after it.)
  const own = (row.content.content ?? []).filter((n, i, all) => !(all.length === 1 && n.type === "paragraph" && !n.content?.length));
  const content: Doc = { ...row.content, type: "doc", content: [{ type: "rowView" } as DocNode, ...own] };
  updatePage(rowId, { content });
  return true;
}

/** Every row of every database that has a custom view brought up to it (the pages made before it existed). How many were written. */
export function ensureRowViews(): number {
  const dbs = (getSqlite().prepare("select id from ws_pages where kind = 'database' and archived_at is null").all() as { id: number }[]).filter((d) => rowViewOf(getDatabase(d.id)?.schema.dataType));
  let n = 0;
  for (const { id } of dbs) {
    const rows = getSqlite().prepare("select id from ws_pages where db_id = ? and archived_at is null").all(id) as { id: number }[];
    for (const r of rows) if (ensureRowView(r.id)) n++;
  }
  return n;
}

const OLD_FOLDER = "system.detailFolder";

/**
 * The detail layouts (System → Detail views) are gone — a row's page is the row's view, and a plugin's view is one block of it.
 * The old folder and the pages in it go to the trash (they come back from there), once.
 */
export function retireDetailLayouts(): boolean {
  const id = getPref<number | null>(OLD_FOLDER, null);
  if (!id) return false;
  const folder = getPage(id);
  if (folder && !folder.archivedAt) {
    removeSystemPages([id, ...subtree(id)]);
    archivePage(id);
  }
  setPref(OLD_FOLDER, null);
  return true;
}
