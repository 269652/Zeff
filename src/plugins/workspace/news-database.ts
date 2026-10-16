import { getPref, setPref } from "@/lib/prefs";
import { isInstalled } from "@/plugins/state";
import { t } from "@/lib/i18n/server";
import { getDatabase } from "./store";

const NEWS = "workspace.newsDb";

/** The database of the news you kept — null: not made, or gone. */
export function newsDatabase(): number | null {
  const id = getPref<number | null>(NEWS, null);
  return id && getDatabase(id) && !getDatabase(id)!.page.archivedAt ? id : null;
}

/** The title of that database — the summary agent's instructions name it. */
export const newsDatabaseTitle = (): string => t("Saved news");

/** The news you saved or liked as a database of the Workspace — once, when the News plugin is installed (a gone one is not made again). */
export async function ensureNewsDatabase(): Promise<void> {
  if (!isInstalled("workspace") || !isInstalled("news")) return;
  if (newsDatabase() || getPref<number | null>(NEWS, null) !== null) return;
  const { createExtSourceDatabase } = await import("./derived");
  const id = await createExtSourceDatabase("news", newsDatabaseTitle());
  setPref(NEWS, id);
  const { runPipeline } = await import("./pipeline");
  await runPipeline(id, { ai: false });
}
