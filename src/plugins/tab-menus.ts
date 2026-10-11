import type { PluginId } from "./catalog";
import { installedPlugins } from "./state";
import type { TabMenuItem } from "./tab-menus-shared";

/**
 * The header tabs with a dropdown (a split button): each plugin's module gives its entries —
 * loaded when the dropdown opens, not with every page.
 */
const MENUS: Partial<Record<PluginId, { tab: string; items: () => Promise<TabMenuItem[]> }>> = {
  kanban: { tab: "/kanban", items: async () => (await import("./kanban/tab-menu")).tabMenu() },
  keep: { tab: "/keep", items: async () => (await import("./keep/tab-menu")).tabMenu() },
};

/** The tabs (addresses) whose plugin gives a dropdown. */
export const tabsWithMenu = (): Set<string> => {
  const on = installedPlugins();
  return new Set(Object.entries(MENUS).flatMap(([id, m]) => (on.has(id as PluginId) && m ? [m.tab] : [])));
};

/** A tab's dropdown entries — none for a tab without one (or its plugin not installed). */
export async function tabMenu(tab: string): Promise<TabMenuItem[]> {
  const on = installedPlugins();
  const m = Object.entries(MENUS).find(([id, x]) => x?.tab === tab && on.has(id as PluginId))?.[1];
  return m ? m.items() : [];
}
