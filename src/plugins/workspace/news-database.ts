import { getPref, setPref } from "@/lib/prefs";
import { isInstalled } from "@/plugins/state";
import { t } from "@/lib/i18n/server";
import { newView } from "./model";
import { getDatabase, updateSchema } from "./store";

const NEWS = "workspace.newsDb";
const CARDS = "workspace.newsCards";
const CARDS_HIDDEN = "workspace.newsCardsHidden";

/** The database of the news you kept — null: not made, or gone. */
export function newsDatabase(): number | null {
  const id = getPref<number | null>(NEWS, null);
  return id && getDatabase(id) && !getDatabase(id)!.page.archivedAt ? id : null;
}

/** The cards: the picture on top, the headline, publisher, date, link and its checks, the text folded — the pipeline's own fields and the rest stay in the table. */
const cardsView = () => ({ ...newView(t("Cards"), "gallery"), hidden: ["srcref", "srcedited", "srcurl", "newsscore", "newstags", "newsstory", "newsimage"] });

/** The title of that database — the summary agent's instructions name it. */
export const newsDatabaseTitle = (): string => t("Saved news");

/** The news you saved or liked as a database of the Workspace — once, when the News plugin is installed (a gone one is not made again). */
export async function ensureNewsDatabase(): Promise<void> {
  if (!isInstalled("workspace") || !isInstalled("news")) return;
  const known = newsDatabase();
  if (known) {
    // Cards first (made before they existed: once).
    if (getPref<boolean>(CARDS, false) !== true) {
      setPref(CARDS, true);
      const cur = getDatabase(known)!.schema;
      if (!cur.views.some((v) => v.type === "gallery")) updateSchema(known, { ...cur, views: [cardsView(), ...cur.views] });
    }
    // Cards made before they hid the pipeline's fields: once.
    if (getPref<boolean>(CARDS_HIDDEN, false) !== true) {
      setPref(CARDS_HIDDEN, true);
      const cur = getDatabase(known)!.schema;
      if (cur.views.some((v) => v.type === "gallery" && !v.hidden.length)) updateSchema(known, { ...cur, views: cur.views.map((v) => (v.type === "gallery" && !v.hidden.length ? { ...v, hidden: cardsView().hidden } : v)) });
    }
    return;
  }
  if (getPref<number | null>(NEWS, null) !== null) return;
  const { createExtSourceDatabase } = await import("./derived");
  const id = await createExtSourceDatabase("news", newsDatabaseTitle());
  setPref(NEWS, id);
  setPref(CARDS, true);
  setPref(CARDS_HIDDEN, true);
  const cur = getDatabase(id)!.schema;
  updateSchema(id, { ...cur, views: [cardsView(), ...cur.views] });
  const { runPipeline } = await import("./pipeline");
  await runPipeline(id, { ai: false });
}
