import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { TabMenuItem } from "./tab-menus-shared";

/**
 * The header tabs with a dropdown (a split button): a plugin that has one contributes it from its
 * server.ts — the tab's address and the entries, loaded when the dropdown opens, not with every page.
 * The point is on its own, so a plugin's server.ts can register without loading the file that loads all server.ts files.
 */
export type TabMenu = { tab: string; items: () => Promise<TabMenuItem[]> };
export const tabMenus = extensionPoint<TabMenu>("shell.tabMenus");
