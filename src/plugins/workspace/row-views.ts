import { getSqlite } from "@/db";
import { isInstalled } from "@/plugins/state";
import { docText, type Doc, type DocNode } from "./doc";
import type { DataType } from "./model";
import { getPref, setPref } from "@/lib/prefs";
import { removeSystemPages } from "@/lib/prompts/system-pages";
import { archivePage, getDatabase, getPage, subtree, updatePage } from "./store";
import { personPageLayout } from "@/plugins/people/page-layout";

/**
 * A custom view of a row: a plugin brings ONE view for the rows of a database of a type (the person's page for the people
 * database). It is a block of the row's own page (`rowView`) — the rest of the page is free text and blocks. Not installed, the
 * block shows nothing. Made once for each row: a page of such a row starts with it (the row's own text stays after it).
 */
export type RowView = { id: string; plugin: string; dataType: DataType; label: string; /** What a page of such a row starts with after the block (when it has nothing of its own). */ layout?: () => DocNode[] };

export const ROW_VIEWS: RowView[] = [
  { id: "person", plugin: "people", dataType: "people", label: "Person", layout: personPageLayout },
  { id: "case", plugin: "cases", dataType: "cases", label: "Case" },
];

/** The custom view the rows of a database of this type have now (its plugin installed). */
export const rowViewOf = (dataType: DataType | undefined): RowView | undefined => (dataType ? ROW_VIEWS.find((v) => v.dataType === dataType && isInstalled(v.plugin)) : undefined);

const has = (doc: Doc): boolean => (doc.content ?? []).some((n) => n.type === "rowView");

const blank = (n: DocNode): boolean => n.type === "paragraph" && !n.content?.length;
const viewOfRow = (row: ReturnType<typeof getPage>): RowView | undefined => {
  const db = row?.dbId && !row.archivedAt ? getDatabase(row.dbId) : null;
  return db ? rowViewOf(db.schema.dataType) : undefined;
};

/**
 * A row's page made to start with its database's custom view — when it has one and the page doesn't. A page with nothing of its
 * own gets the view's layout after the block too (a new person's page: their todos, what is coming up …). True: it was written.
 */
export function ensureRowView(rowId: number): boolean {
  const row = getPage(rowId);
  const view = viewOfRow(row);
  if (!row || !view || has(row.content)) return false;
  const own = (row.content.content ?? []).every(blank) ? [] : (row.content.content ?? []);
  // (An empty page without a layout: just the block — not an empty paragraph after it.)
  const layout = own.length ? [] : (view.layout?.() ?? []);
  const content: Doc = { ...row.content, type: "doc", content: [{ type: "rowView" } as DocNode, ...layout, ...(layout.length ? [{ type: "paragraph" }] : own)] };
  updatePage(rowId, { content });
  return true;
}

const hasWidget = (n: DocNode): boolean => n.type === "zeffWidget" || (n.content ?? []).some(hasWidget);

/** The row's view has a layout and its page is (nearly) empty: no widget, a line or two of its own at most — "Use the default layout" fits. */
export function rowLayoutFits(rowId: number): boolean {
  const row = getPage(rowId);
  if (!viewOfRow(row)?.layout || !row) return false;
  const own = (row.content.content ?? []).filter((n) => n.type !== "rowView");
  return !own.some(hasWidget) && own.map((n) => docText(n)).join(" ").trim().length <= 280;
}

/** "Use the default layout": the view's layout put in after its block, what the page says kept after it. False: it doesn't fit. */
export function applyRowLayout(rowId: number): boolean {
  if (!rowLayoutFits(rowId)) return false;
  // (A page without the view block yet and nothing of its own gets the layout with the block.)
  if (ensureRowView(rowId) && !rowLayoutFits(rowId)) return true;
  const row = getPage(rowId)!;
  const nodes = row.content.content ?? [];
  const at = nodes.findIndex((n) => n.type === "rowView") + 1;
  const own = nodes.slice(at).filter((n) => !blank(n));
  updatePage(rowId, { content: { ...row.content, type: "doc", content: [...nodes.slice(0, at), ...viewOfRow(row)!.layout!(), ...own, { type: "paragraph" }] } });
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
