import { getPref, setPref } from "@/lib/prefs";
import { isInstalled } from "@/plugins/state";
import { t } from "@/lib/i18n/server";
import { appViewsFor } from "./app-views";
import { newView } from "./model";
import { getDatabase, getPage, rawRows, updatePage, updateSchema } from "./store";

const PEOPLE = "workspace.peopleDb";

/** The database "People" ("Personen" in German) — null: not made, or gone. */
export function peopleDatabase(): number | null {
  const id = getPref<number | null>(PEOPLE, null);
  return id && getDatabase(id) && !getDatabase(id)!.page.archivedAt ? id : null;
}

/** Your profiles as a database of the Workspace — once, when the People plugin is installed (a gone one isn't made again). */
export async function ensurePeopleDatabase(): Promise<void> {
  if (!isInstalled("workspace") || !isInstalled("people")) return;
  // Made before the person's page existed: it gets one.
  const known = peopleDatabase();
  if (known) {
    if (!getDatabase(known)!.schema.detailPage) (await import("./detail-page")).ensureDetailPage(known);
    const layout = getDatabase(known)!.schema.detailPage;
    if (layout) widenSummary(layout);
    // The overview view (made before it existed: put first).
    const cur = getDatabase(known)!.schema;
    const app = appViewsFor("people")[0];
    if (app && !cur.views.some((v) => v.type === "app" && v.app === app.id)) updateSchema(known, { ...cur, views: [{ ...newView(t(app.label), "table"), type: "app", app: app.id }, ...cur.views] });
    return;
  }
  if (getPref<number | null>(PEOPLE, null) !== null) return;
  const { createExtSourceDatabase } = await import("./derived");
  const id = await createExtSourceDatabase("people");
  setPref(PEOPLE, id);
  const { runPipeline } = await import("./pipeline");
  await runPipeline(id, { ai: false });
}

/** Where a person's page is: their row in the people database — the database itself without one (a profile not read in yet), the Workspace without a database. */
export function personHref(personId: number): string {
  const db = peopleDatabase();
  const row = db ? rawRows(db).find((r) => r.cells.srcref === `person:${personId}`) : null;
  return row ? `/workspace/${row.id}` : db ? `/workspace/${db}` : "/workspace";
}

/** The people page made before columns had widths: the column of the summary gets two, once (a width set since stays). */
export function widenSummary(layoutId: number): void {
  const page = getPage(layoutId);
  if (!page) return;
  const doc = JSON.parse(JSON.stringify(page.content)) as { content?: { type: string; attrs?: Record<string, unknown>; content?: unknown[] }[] };
  let changed = false;
  const walk = (nodes: { type: string; attrs?: Record<string, unknown>; content?: unknown[] }[]) => {
    for (const n of nodes) {
      const kids = (n.content ?? []) as typeof nodes;
      if (n.type === "flexBox" && n.attrs?.span === undefined && kids.some((k) => k.type === "zeffModule" && k.attrs?.module === "person-summary")) {
        n.attrs = { ...n.attrs, span: 2 };
        changed = true;
      }
      walk(kids);
    }
  };
  walk(doc.content ?? []);
  if (changed) updatePage(layoutId, { content: doc });
}

/** The pages of all the people at once, by profile id (what a screen full of names needs). */
export function personHrefs(): Record<number, string> {
  const db = peopleDatabase();
  const out: Record<number, string> = {};
  if (!db) return out;
  for (const r of rawRows(db)) {
    const m = /^person:(\d+)$/.exec(String(r.cells.srcref ?? ""));
    if (m) out[Number(m[1])] = `/workspace/${r.id}`;
  }
  return out;
}

/** Where the people are (their database), for links to "the people". */
export const peopleHome = (): string => {
  const db = peopleDatabase();
  return db ? `/workspace/${db}` : "/workspace";
};
