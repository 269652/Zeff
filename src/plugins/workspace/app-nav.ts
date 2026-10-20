import { getSqlite } from "@/db";
import { t } from "@/lib/i18n/server";
import { docNav, factsOf, type NavEntry } from "@/plugins/documents/nav";
import type { Row, View } from "./model";
import { rowsOf } from "./store";

/**
 * The navigation of an app's view in the Workspace tree: an app whose sidebar lists entries (the documents' inbox, all, by type …)
 * can show them under its database in the tree instead — the view's setting `nav: "workspace"`. The entries are read from the rows;
 * one can be hidden and shown again (`navHidden`), never deleted.
 */
export type AppNavEntry = NavEntry & { hidden: boolean };
export type AppNav = { viewId: string; entries: AppNavEntry[] };

/** The apps that have a navigation: their entries from the database's rows. */
const NAVS: Record<string, (rows: Row[]) => NavEntry[]> = {
  documents: (rows) => docNav(rows.map((r) => factsOf(r.cells)), (s) => t(s)),
};
export const hasNav = (app: string | undefined): boolean => !!app && app in NAVS;

/** The databases whose view keeps its navigation in the tree, by database id. */
export function appNavs(): Record<number, AppNav> {
  const out: Record<number, AppNav> = {};
  const ids = getSqlite().prepare("select id from ws_pages where kind = 'database' and archived_at is null and instr(schema, '\"nav\"') > 0").all() as { id: number }[];
  for (const { id } of ids) {
    const d = rowsOf(id);
    const view = d?.schema.views.find((v: View) => v.type === "app" && v.nav === "workspace" && hasNav(v.app));
    if (!d || !view) continue;
    const hidden = new Set(view.navHidden ?? []);
    out[id] = { viewId: view.id, entries: NAVS[view.app!](d.rows).map((e) => ({ ...e, hidden: hidden.has(e.id) })) };
  }
  return out;
}
