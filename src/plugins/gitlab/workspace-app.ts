import { getPref, setPref } from "@/lib/prefs";

const PREF = "gitlab.workspaceApp";

/**
 * GitLab in the Workspace: its database "GitLab" (the synced items, items-source.ts) shown by GitLab's app view — made the first time it is
 * opened (a deleted one is made again: GitLab has no other home), its items read again when the last read is a while ago. Its id; null: the
 * Workspace isn't there.
 */
export async function gitlabApp(): Promise<number | null> {
  const { isInstalled } = await import("@/plugins/state");
  if (!isInstalled("workspace") || !isInstalled("gitlab")) return null;
  const { getDatabase, updatePage } = await import("@/plugins/workspace/store");
  const pipeline = await import("@/plugins/workspace/pipeline");
  const known = getPref<number | null>(PREF, null);
  const db = known ? getDatabase(known) : null;
  if (known && db && !db.page.archivedAt) {
    const ran = Date.parse(db.schema.pipeline?.ranAt ?? "");
    if (!ran || Date.now() - ran > 2 * 60000) pipeline.startPipeline(known, { ai: false });
    return known;
  }
  const { createExtSourceDatabase } = await import("@/plugins/workspace/derived");
  const id = await createExtSourceDatabase("gitlab-items", "GitLab");
  updatePage(id, { favorite: true });
  setPref(PREF, id);
  await pipeline.runPipeline(id, { ai: false });
  return id;
}
