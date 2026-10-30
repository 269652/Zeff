/** The menu's settings (client-safe): where each application shows, which menu entries are hidden. */

/** header: a tab in Zeff's header · menu: under "Apps" in the menu · hidden: nowhere (its page still works, under Apps). */
export type Placement = "header" | "menu" | "hidden";

export type MenuPrefs = {
  /** Each application's place, by its address — not set: its plugin's default. */
  place: Record<string, Placement>;
  /** The other menu entries (plugins' pages, Zeff's own) hidden, by address. */
  hidden: string[];
  /** The order you put things in (Menu → Anpassen, ↑↓): addresses — "group:<plugin>" for a plugin's group. */
  order: string[];
};

export const DEFAULT_MENU: MenuPrefs = { place: {}, hidden: [], order: [] };

/** A list in the order you put it in: those you sorted first, by your order; the others after, as they came. */
export function inOrder<T>(list: T[], key: (t: T) => string, order: string[]): T[] {
  const at = new Map(order.map((k, i) => [k, i]));
  return list
    .map((t, i) => ({ t, r: at.get(key(t)) ?? order.length + i }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.t);
}

/** An installed plugin's application, where it shows. */
export type AppView = {
  href: string;
  label: string;
  /** In the header on a phone. */
  short: string;
  hint: string;
  /** Other pages it counts as active on (the weekly report's entries). */
  also?: string[];
  pluginName: string;
  place: Placement;
  /** Its plugin's default place. */
  defaultPlace: Placement;
};
