import "./contributions";
import { tabMenus } from "./tab-menus-point";
import type { TabMenuItem } from "./tab-menus-shared";

/** The tabs (addresses) whose installed plugin gives a dropdown. */
export const tabsWithMenu = (): Set<string> => new Set(tabMenus.list().map((c) => c.impl.tab));

/** A tab's dropdown entries — none for a tab without one (or its plugin not installed). */
export async function tabMenu(tab: string): Promise<TabMenuItem[]> {
  const m = tabMenus.list().find((c) => c.impl.tab === tab);
  return m ? m.impl.items() : [];
}
