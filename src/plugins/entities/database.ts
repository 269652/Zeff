import { getPref, setPref } from "@/lib/prefs";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import type { EntityKind } from "./store";

/**
 * The Entities plugin's databases in the Workspace — "Organisations", "Projects", "Places": a row per entity, its page what Zeff
 * gathered about it (detail.ts), its fields two-way (workspace-source.ts). Each made once while the plugin is installed (a gone
 * one isn't made again), like the People database.
 */

const PREF: Record<EntityKind, string> = { org: "workspace.orgsDb", project: "workspace.projectsDb", place: "workspace.placesDb" };
/** The source each kind's database reads. */
export const SOURCE_OF: Record<EntityKind, string> = { org: "orgs", project: "projects", place: "places" };
const TITLE = (): Record<EntityKind, string> => ({ org: t("Organisations"), project: t("Projects"), place: t("Places") });

/** A kind's database — null: not made, or gone. */
export async function entityDatabase(kind: EntityKind): Promise<number | null> {
  const id = getPref<number | null>(PREF[kind], null);
  if (!id) return null;
  const { getDatabase } = await import("@/plugins/workspace/store");
  const d = getDatabase(id);
  return d && !d.page.archivedAt ? id : null;
}

/** The three databases — once each, while Entities is installed. */
export async function ensureEntityDatabases(): Promise<void> {
  if (!isInstalled("workspace") || !isInstalled("entities")) return;
  for (const kind of ["org", "project", "place"] as const) {
    if (getPref<number | null>(PREF[kind], null) !== null) continue;
    const { createExtSourceDatabase } = await import("@/plugins/workspace/derived");
    const id = await createExtSourceDatabase(SOURCE_OF[kind], TITLE()[kind]);
    setPref(PREF[kind], id);
    const { runPipeline } = await import("@/plugins/workspace/pipeline");
    await runPipeline(id, { ai: false });
  }
}

