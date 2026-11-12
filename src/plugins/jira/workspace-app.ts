import { getPref, setPref } from "@/lib/prefs";

const PREF = "jira.workspaceApp";

/**
 * Jira in the Workspace: its database "Jira" (the synced tickets, tickets-source.ts) shown by Jira's app view — made the first time it is
 * opened (a deleted one is made again: Jira has no other home), its tickets read again when the last read is a while ago. Its id; null: the
 * Workspace isn't there.
 */
export async function jiraApp(): Promise<number | null> {
  const { isInstalled } = await import("@/plugins/state");
  if (!isInstalled("workspace") || !isInstalled("jira")) return null;
  const { getDatabase, updatePage } = await import("@/plugins/workspace/store");
  const { startPipeline } = await import("@/plugins/workspace/pipeline");
  const known = getPref<number | null>(PREF, null);
  const db = known ? getDatabase(known) : null;
  if (known && db && !db.page.archivedAt) {
    const ran = Date.parse(db.schema.pipeline?.ranAt ?? "");
    if (!ran || Date.now() - ran > 2 * 60000) startPipeline(known, { ai: false });
    return known;
  }
  const { createExtSourceDatabase } = await import("@/plugins/workspace/derived");
  const id = await createExtSourceDatabase("jira-tickets", "Jira");
  updatePage(id, { favorite: true });
  setPref(PREF, id);
  await (await import("@/plugins/workspace/pipeline")).runPipeline(id, { ai: false });
  return id;
}
