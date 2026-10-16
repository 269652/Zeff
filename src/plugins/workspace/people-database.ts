import { getPref, setPref } from "@/lib/prefs";
import { isInstalled } from "@/plugins/state";
import { getDatabase, rawRows } from "./store";

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
    return;
  }
  if (getPref<number | null>(PEOPLE, null) !== null) return;
  const { createExtSourceDatabase } = await import("./derived");
  const id = await createExtSourceDatabase("people");
  setPref(PEOPLE, id);
  const { runPipeline } = await import("./pipeline");
  await runPipeline(id, { ai: false });
}

/** Where a person's mention goes: their row in the people database — their profile page without one (or for a profile not read in yet). */
export function personHref(personId: number): string {
  const db = peopleDatabase();
  const row = db ? rawRows(db).find((r) => r.cells.srcref === `person:${personId}`) : null;
  return row ? `/workspace/${row.id}` : `/personen/${personId}`;
}
