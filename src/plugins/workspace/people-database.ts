import { getPref, setPref } from "@/lib/prefs";
import { isInstalled } from "@/plugins/state";
import { getDatabase } from "./store";

const PEOPLE = "workspace.peopleDb";

/** The database "People" ("Personen" in German) — null: not made, or gone. */
export function peopleDatabase(): number | null {
  const id = getPref<number | null>(PEOPLE, null);
  return id && getDatabase(id) && !getDatabase(id)!.page.archivedAt ? id : null;
}

/** Your profiles as a database of the Workspace — once, when the People plugin is installed (a gone one isn't made again). */
export async function ensurePeopleDatabase(): Promise<void> {
  if (!isInstalled("workspace") || !isInstalled("people") || getPref<number | null>(PEOPLE, null) !== null) return;
  const { createExtSourceDatabase } = await import("./derived");
  const id = await createExtSourceDatabase("people");
  setPref(PEOPLE, id);
  const { runPipeline } = await import("./pipeline");
  await runPipeline(id, { ai: false });
}
