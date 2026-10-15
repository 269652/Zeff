import { DEFAULT_MENU, inOrder, type AppView, type MenuPrefs } from "@/lib/layout-shared";
import { getPref, setPref } from "@/lib/prefs";
import { t } from "@/lib/i18n/server";
import { PLUGINS } from "./catalog";
import { catalogText } from "./catalog-text";
import { installedPlugins } from "./state";
import { enabledPlugins } from "@/lib/ext/registry";

/** The applications' default order (a plugin's tabs — Work, Todos …); the plugins' apps (Mail, Gmail …) after. */
const TAB_ORDER = ["work", "todos", "tickets", "kanban", "weekly-report", "monthly-report", "knowledge"];

/** The menu's settings (Menu → Anpassen) — per account. */
export const getMenuPrefs = (): MenuPrefs => {
  const p = getPref<Partial<MenuPrefs>>("menu", {});
  return { place: p.place ?? {}, hidden: p.hidden ?? DEFAULT_MENU.hidden, order: p.order ?? DEFAULT_MENU.order };
};
export const setMenuPrefs = (patch: Partial<MenuPrefs>) => setPref("menu", { ...getMenuPrefs(), ...patch });

/**
 * Every installed plugin's applications — its tabs (in the header by default) and its apps (in the
 * menu's "Apps" by default) — each where the menu's settings put it. Their words (label, short,
 * hint, plugin name) in the account's language.
 */
export function allApps(): AppView[] {
  const on = installedPlugins();
  const tr = (s: string) => catalogText(t, s);
  const prefs = getMenuPrefs();
  const rank = (id: string) => (TAB_ORDER.includes(id) ? TAB_ORDER.indexOf(id) : TAB_ORDER.length);
  const plugins = PLUGINS.filter((p) => on.has(p.id)).sort((a, b) => rank(a.id) - rank(b.id));
  // External plugins (src/lib/ext) bring apps the same way: a panel of theirs opened as a page.
  const external = enabledPlugins().flatMap((p) => p.manifest.contributes.apps.map((a) => ({ href: `/ext/view/${p.id}/${a.panel}`, label: a.label, short: a.short, hint: a.hint || p.manifest.name, pluginName: p.manifest.name })));
  const seen = new Set<string>();
  const apps: AppView[] = [];
  for (const [list, defaultPlace] of [
    [plugins.flatMap((p) => (p.tabs ?? []).map((x) => ({ ...x, label: tr(x.label), short: tr(x.short), hint: tr(p.name), pluginName: tr(p.name) }))), "header"],
    [[...plugins.flatMap((p) => (p.apps ?? []).map((a) => ({ ...a, label: tr(a.label), short: tr(a.short), hint: tr(a.hint), pluginName: tr(p.name) }))), ...external], "menu"],
  ] as const) {
    for (const a of list) {
      if (seen.has(a.href)) continue;
      seen.add(a.href);
      apps.push({ ...a, defaultPlace, place: prefs.place[a.href] ?? defaultPlace });
    }
  }
  return inOrder(apps, (a) => a.href, prefs.order);
}

/** The header's tabs: the applications put there. */
export const appTabs = () => allApps().filter((a) => a.place === "header");

/** Where home goes without the weekly report: the first application in the header (else in the menu) — else the plugins. */
export const firstAppTab = () => allApps().find((t) => t.href !== "/" && t.place !== "hidden")?.href ?? "/plugins";
