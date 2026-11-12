import { getPref, setPref } from "@/lib/prefs";
import { t } from "@/lib/i18n/server";
import type { DbSchema } from "@/plugins/workspace/model";

const PREF = "news.workspaceApp";

/**
 * News in the Workspace: a page of its own ("News", a database of the type "news") shown by News' app view (view-template.meta.ts) — made once,
 * when it is first opened. Its id; null: the Workspace isn't there. A deleted one is made again (News has no other home).
 */
export async function newsApp(): Promise<number | null> {
  const { isInstalled } = await import("@/plugins/state");
  if (!isInstalled("workspace") || !isInstalled("news")) return null;
  const { createPage, getDatabase, updatePage } = await import("@/plugins/workspace/store");
  const known = getPref<number | null>(PREF, null);
  const db = known ? getDatabase(known) : null;
  if (known && db && !db.page.archivedAt) return known;
  const { newView } = await import("@/plugins/workspace/model");
  const schema: DbSchema = { titleName: t("Title"), properties: [], views: [{ ...newView(t("News"), "table"), type: "app", app: "news" }], dataType: "news" };
  const id = createPage({ kind: "database", title: t("News"), icon: "📰", schema });
  updatePage(id, { fullWidth: true, favorite: true });
  setPref(PREF, id);
  return id;
}
