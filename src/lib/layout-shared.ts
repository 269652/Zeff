/** The menu's settings (client-safe): where each application shows, which menu entries are hidden. */

/** header: a tab in Zeff's header · menu: under "Apps" in the menu · hidden: nowhere (its page still works, under Apps). */
export type Placement = "header" | "menu" | "hidden";

export const PLACEMENT_LABELS: Record<Placement, string> = { header: "Kopfzeile", menu: "Menü", hidden: "ausgeblendet" };

export type MenuPrefs = {
  /** Each application's place, by its address — not set: its plugin's default. */
  place: Record<string, Placement>;
  /** The other menu entries (plugins' pages, Zeff's own) hidden, by address. */
  hidden: string[];
};

export const DEFAULT_MENU: MenuPrefs = { place: {}, hidden: [] };

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
