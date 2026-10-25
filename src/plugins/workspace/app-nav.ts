import { getSqlite } from "@/db";
import { t } from "@/lib/i18n/server";
import type { NavEntry } from "@/plugins/documents/nav";
import { appNavProviders } from "./app-nav-point";
import { dateRange, type View } from "./model";
import { getDatabase, labelFns, labelsFor, rowsOf } from "./store";
import { viewAppMeta } from "./view-apps";
import { navOf, renderView, viewDefaults } from "./view-template";

/**
 * The navigation of a view in the Workspace tree: a view whose sidebar lists entries (the documents' inbox, all, by type …; a
 * template's <nav> — the newest journal entries) can show them under its database in the tree instead — the view's setting
 * `nav: "workspace"`. The entries are read from the rows: by the plugin that brings the app (app-nav-point.ts), or by drawing the
 * view's template; one can be hidden and shown again (`navHidden`), never deleted.
 */
export type AppNavEntry = NavEntry & { hidden: boolean; /** Where it leads (a row's page, an address); none: the view, with the entry picked (?nav=). */ href?: string };
export type AppNav = { viewId: string; entries: AppNavEntry[] };

const loaded = async () => void (await import("@/plugins/contributions"));
const providerOf = (app: string | undefined) => (app ? appNavProviders.list().flatMap((c) => c.impl).find((p) => p.app === app) : undefined);
/** A view's template (its own, else its app's). */
const templateOf = (view: Pick<View, "app" | "template">): string => view.template ?? (view.app ? (viewAppMeta(view.app)?.defaultTemplate((s) => t(s)) ?? "") : "");

/** Whether an app's view has a navigation (a plugin brings it, or its template has a <nav>). */
export async function hasNav(app: string | undefined, template?: string): Promise<boolean> {
  await loaded();
  return !!providerOf(app) || /<nav[\s>]/.test(template ?? templateOf({ app }));
}

/** A template view's sidebar entries, drawn on the server from the rows (what app.* the view loads in the browser isn't here). */
async function templateNav(dbId: number, view: View): Promise<AppNavEntry[]> {
  const d = rowsOf(dbId);
  const page = getDatabase(dbId)?.page;
  if (!d || !page) return [];
  const src = templateOf(view);
  const labels = labelFns(await labelsFor(d.schema, d.rows));
  const r = renderView(src, { rows: d.rows, props: d.schema.properties, titleName: d.schema.titleName, state: viewDefaults(src), app: {}, db: { id: dbId, title: page.title }, labels });
  return (navOf(r.nodes)?.entries ?? []).map((e) => ({ id: e.id, label: e.label, icon: e.icon, n: e.n, ...(e.group ? { group: e.group } : {}), hidden: false, ...(e.row ? { href: `/workspace/${e.row}` } : e.href ? { href: e.href } : {}) }));
}

/** The databases whose view keeps its navigation in the tree, by database id. */
export async function appNavs(): Promise<Record<number, AppNav>> {
  await loaded();
  const out: Record<number, AppNav> = {};
  const ids = getSqlite().prepare("select id from ws_pages where kind = 'database' and archived_at is null and instr(schema, '\"nav\"') > 0").all() as { id: number }[];
  for (const { id } of ids) {
    const d = getDatabase(id);
    const view = d?.schema.views.find((v: View) => v.type === "app" && v.nav === "workspace");
    if (!d || !view) continue;
    const provider = providerOf(view.app);
    const entries: AppNavEntry[] = provider ? provider.entries(rowsOf(id)?.rows ?? []).map((e) => ({ ...e, hidden: false })) : await templateNav(id, view).catch(() => []);
    if (!provider && !entries.length && !/<nav[\s>]/.test(templateOf(view))) continue;
    const hidden = new Set(view.navHidden ?? []);
    out[id] = { viewId: view.id, entries: entries.map((e) => ({ ...e, hidden: hidden.has(e.id) })) };
  }
  // The entries closed (close-row.ts): under their database too, the newest ten — those its own navigation shows already not twice.
  const closed = getSqlite()
    .prepare("select id, db_id, title, icon, props from ws_pages where db_id is not null and locked = 1 and archived_at is null and template = 0 order by updated_at desc")
    .all() as { id: number; db_id: number; title: string; icon: string; props: string }[];
  for (const dbId of [...new Set(closed.map((c) => c.db_id))]) {
    const d = getDatabase(dbId);
    if (!d || d.page.archivedAt) continue;
    const has = out[dbId] ?? { viewId: d.schema.views[0]?.id ?? "", entries: [] };
    const hidden = new Set(d.schema.views.find((v) => v.id === has.viewId)?.navHidden ?? []);
    // (Named by its day too — a journal's entries often have no title: "22.10. · First Day".)
    const date = d.schema.properties.find((p) => p.type === "date");
    const dayOf = (props: string) => {
      try {
        const v = date ? dateRange((JSON.parse(props) as Record<string, unknown>)[date.id])?.start : undefined;
        return v && /^\d{4}-\d{2}-\d{2}/.test(v) ? `${v.slice(8, 10)}.${v.slice(5, 7)}.` : "";
      } catch {
        return "";
      }
    };
    const fresh = closed
      .filter((c) => c.db_id === dbId && !has.entries.some((e) => e.id === `row:${c.id}`))
      .slice(0, 10)
      .map((c): AppNavEntry => ({ id: `row:${c.id}`, label: [dayOf(c.props), c.title].filter(Boolean).join(" · ") || t("Untitled"), icon: c.icon || "🔒", n: 0, group: t("Closed entries"), hidden: hidden.has(`row:${c.id}`), href: `/workspace/${c.id}` }));
    if (fresh.length) out[dbId] = { ...has, entries: [...has.entries, ...fresh] };
  }
  return out;
}
