/**
 * How a built-in plugin describes itself. Every plugin has `src/plugins/<id>/plugin.ts` with
 * `export default definePlugin({ … })` — its manifest: what it is, what it needs and what it brings
 * (tabs, pages, syncs, services …). The list of plugins is generated from those files
 * (`npm run plugins:index` → plugins/index.generated.ts), so a plugin is added by its folder alone.
 * What it brings that is code (actions, AI tasks, board providers …) is in its `server.ts`.
 * Client-safe: data only, no imports from the plugin's code.
 */

export type PluginCategory = "app" | "ai" | "connector" | "timesheet" | "language" | "system";

/** An extension a plugin brings to another (plugins/extensions.ts reads them, with the ids checked). */
export type ExtensionShape = {
  /** Unique within the plugin that brings it ("note-action"). */
  key: string;
  /** The plugin it extends. */
  for: string;
  name: string;
  description: string;
  /** More plugins it needs (besides the one that brings it and the one it extends). */
  requires?: string[];
  /** On by itself once its plugins are there (until you turn it off). */
  defaultInstalled: boolean;
  /** The sync steps it brings — there only while it's on. */
  syncSteps?: string[];
  /** The actions (operation types) it brings — offered and run only while it's on. */
  actions?: string[];
};

export type PluginShape<Id extends string = string> = {
  id: Id;
  /** Where it stands in lists and menus (lower first). Zeff's own plugins have one; a mounted integration's come after them. */
  order?: number;
  name: string;
  description: string;
  category: PluginCategory;
  /** Installed when Zeff starts out (until you change it). */
  defaultInstalled: boolean;
  /** What it needs on this machine, in words. */
  requires?: string;
  /** The plugins it builds on — without them it isn't there either (installing it installs them). */
  dependsOn?: string[];
  /** Its tabs in the header (an application's). */
  tabs?: { href: string; label: string; short: string; also?: string[]; /** Not shown while this plugin is installed (it takes over: the Calendar is a database of the Workspace there). */ unless?: string }[];
  /** Its settings page — the setup's "Set up" step and the menu link to it. */
  settings?: { href: string; what: string };
  /** Its applications beside the tabs — views of what it reads (Mail, Gmail, WhatsApp …): under "Apps" in the menu by default (the layout settings move them). */
  apps?: { href: string; label: string; short: string; hint: string; /** Not shown while this plugin is installed (it brings the same entry). */ unless?: string }[];
  /** Its entries in the menu drawer. */
  nav?: { href: string; label: string; hint: string }[];
  /** The pages it owns (a prefix each) — "not installed" while it isn't. */
  routes?: string[];
  /** The sync steps it brings (Sync menu, scheduler). */
  syncSteps?: string[];
  /** The services it signs in to (sign-in prompts). */
  services?: string[];
  /** Where its actions stand in the AI's dictionary (lower first; none: after the others). Keeps the prompt's order stable. */
  actionsOrder?: number;
  /** The AI provider it is. */
  aiProvider?: "copilot" | "claude" | "codex";
  /** What it brings to other plugins — extensions (see extensions.ts), there while all their plugins are. */
  extensions?: ExtensionShape[];
  /** Experimental: not an official integration of the service (it drives its web page or internals) — why it can break or be refused; shown with the liability disclaimer (Plugins page, before installing, where it acts). */
  experimental?: string;
  /** Beta: works, but may break — the warning shown with it (Plugins page, before installing, where it acts). */
  beta?: string;
};

/** Declare a plugin. Keeps the id as a literal type, so the plugin ids are known to the compiler. */
export const definePlugin = <const Id extends string>(def: PluginShape<Id>): PluginShape<Id> => def;
