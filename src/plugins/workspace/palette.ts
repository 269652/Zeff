import type { PaletteItem } from "@/lib/palette";
import { t } from "@/lib/i18n/server";
import { afterSyncPlan } from "./pipeline";
import { getDatabase } from "./store";

/**
 * What the command palette (Ctrl/⌘+K) can do in the Workspace: a new page or database, a pipeline refreshed. Their href is
 * "zeff:<what>" — the palette runs it instead of opening a page. Server only (the route filters them with the pages).
 */
export function workspacePaletteItems(): PaletteItem[] {
  const group = "Actions";
  const items: PaletteItem[] = [
    { id: "ws:new-page", label: `＋ ${t("New page")}`, hint: t("In the Workspace"), href: "zeff:new-page", group, keywords: "new page create neue seite anlegen erstellen notiz note" },
    { id: "ws:new-database", label: `＋ ${t("New database")}`, hint: t("In the Workspace"), href: "zeff:new-database", group, keywords: "new database create neue datenbank anlegen erstellen tabelle table board" },
  ];
  for (const { id } of afterSyncPlan()) {
    const d = getDatabase(id);
    if (!d || d.page.archivedAt) continue;
    items.push({ id: `ws:refresh:${id}`, label: `↻ ${t("Refresh")} “${d.page.title || t("Untitled")}”`, hint: t("Read its sources, run its AI"), href: `zeff:refresh:${id}`, group, keywords: `refresh run pipeline aktualisieren neu lesen starten ${d.page.title}` });
  }
  return items;
}
