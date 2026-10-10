import { DEFAULT_MENU, type AppView, type MenuPrefs } from "@/lib/layout-shared";
import { getPref, setPref } from "@/lib/prefs";
import { PLUGINS } from "./catalog";
import { installedPlugins } from "./state";

/** The applications' default order (a plugin's tabs — Work, Todos …); the plugins' apps (Mail, Gmail …) after. */
const TAB_ORDER = ["work", "todos", "tickets", "kanban", "weekly-report", "monthly-report", "knowledge"];

/** The menu's settings (Menu → Anpassen) — per account. */
export const getMenuPrefs = (): MenuPrefs => {
  const p = getPref<Partial<MenuPrefs>>("menu", {});
  return { place: p.place ?? {}, hidden: p.hidden ?? DEFAULT_MENU.hidden };
};
export const setMenuPrefs = (patch: Partial<MenuPrefs>) => setPref("menu", { ...getMenuPrefs(), ...patch });

/**
 * Every installed plugin's applications — its tabs (in the header by default) and its apps (in the
 * menu's "Apps" by default) — each where the menu's settings put it.
 */
export function allApps(): AppView[] {
  const on = installedPlugins();
  const prefs = getMenuPrefs();
  const rank = (id: string) => (TAB_ORDER.includes(id) ? TAB_ORDER.indexOf(id) : TAB_ORDER.length);
  const plugins = PLUGINS.filter((p) => on.has(p.id)).sort((a, b) => rank(a.id) - rank(b.id));
  const seen = new Set<string>();
  const apps: AppView[] = [];
  for (const [list, defaultPlace] of [
    [plugins.flatMap((p) => (p.tabs ?? []).map((t) => ({ ...t, hint: p.name, pluginName: p.name }))), "header"],
    [plugins.flatMap((p) => (p.apps ?? []).map((a) => ({ ...a, pluginName: p.name }))), "menu"],
  ] as const) {
    for (const a of list) {
      if (seen.has(a.href)) continue;
      seen.add(a.href);
      apps.push({ ...a, defaultPlace, place: prefs.place[a.href] ?? defaultPlace });
    }
  }
  return apps;
}

/** The header's tabs: the applications put there. */
export const appTabs = () => allApps().filter((a) => a.place === "header");
/** The menu's "Apps". */
export const menuApps = () => allApps().filter((a) => a.place === "menu");

/** Where home goes without the weekly report: the first application in the header (else in the menu) — else the plugins. */
export const firstAppTab = () => allApps().find((t) => t.href !== "/" && t.place !== "hidden")?.href ?? "/plugins";
