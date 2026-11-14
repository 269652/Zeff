import { getPref, setPref } from "@/lib/prefs";
import { isInstalled } from "@/plugins/state";
import { t } from "@/lib/i18n/server";
import { appViewFields, appViewsFor } from "./app-views";
import { newView } from "./model";
import { getDatabase, rawRows, updateSchema } from "./store";

const PEOPLE = "workspace.peopleDb";

/** The database "People" ("Personen" in German) — null: not made, or gone. */
export function peopleDatabase(): number | null {
  const id = getPref<number | null>(PEOPLE, null);
  return id && getDatabase(id) && !getDatabase(id)!.page.archivedAt ? id : null;
}

/** Your profiles as a database of the Workspace — once, when the People plugin is installed (a gone one isn't made again). */
export async function ensurePeopleDatabase(): Promise<void> {
  if (!isInstalled("workspace") || !isInstalled("people")) return;
  const known = peopleDatabase();
  if (known) {
    // The person's page is the custom view of its rows: a block at the start of each row's page (pages made before it get it now).
    (await import("./row-views")).ensureRowViews();
    // The overview view (made before it existed: put first).
    const cur = getDatabase(known)!.schema;
    const app = appViewsFor("people")[0];
    if (app && !cur.views.some((v) => v.type === "app" && v.app === app.id)) updateSchema(known, { ...cur, views: [{ ...newView(t(app.label), "table"), ...appViewFields(app) }, ...cur.views] });
    return;
  }
  if (getPref<number | null>(PEOPLE, null) !== null) return;
  const { createExtSourceDatabase } = await import("./derived");
  const id = await createExtSourceDatabase("people");
  setPref(PEOPLE, id);
  const { runPipeline } = await import("./pipeline");
  await runPipeline(id, { ai: false });
  (await import("./row-views")).ensureRowViews();
}

/** Where a person's page is: their row in the people database — the database itself without one (a profile not read in yet), the Workspace without a database. */
export function personHref(personId: number): string {
  const db = peopleDatabase();
  const row = db ? rawRows(db).find((r) => r.cells.srcref === `person:${personId}`) : null;
  return row ? `/workspace/${row.id}` : db ? `/workspace/${db}` : "/workspace";
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
