/**
 * Extensions — plugins for plugins: what one plugin brings to another (Google Keep brings Auto-
 * Aktionen a "Notiz anlegen" action, Todos a Notiz-Durchsicht, the Ticket-Lage your notes). Each is
 * declared by the plugin that brings it (its manifest's `extensions`) and is there only while that
 * plugin, the one it extends and whatever else it needs are installed. Then it's on or off as you
 * set it (Plugins page, under the plugin it extends) — some are on by themselves (`defaultInstalled`)
 * the moment their plugins are there. What it brings (sync steps, actions) goes with it. Client-safe.
 */
import { translator, type T } from "@/lib/i18n/shared";
import { PLUGINS, pluginById, type PluginId } from "./catalog";
import type { ExtensionShape } from "./define";
import { catalogText } from "./catalog-text";

/** An extension as its plugin declares it. */
export type ExtensionDecl = Omit<ExtensionShape, "for" | "requires"> & { for: PluginId; requires?: PluginId[] };

export type Extension = ExtensionDecl & {
  /** "<by>:<key>" — "keep:note-action". */
  id: string;
  /** The plugin that brings it. */
  by: PluginId;
};

export const EXTENSIONS: Extension[] = PLUGINS.flatMap((p) => (p.extensions ?? []).map((e): Extension => ({ ...e, id: `${p.id}:${e.key}`, by: p.id })));

export const extensionById = (id: string) => EXTENSIONS.find((e) => e.id === id);
/** The extension a sync step / an action belongs to (none: the plugin's own). */
export const extensionOfStep = (step: string) => EXTENSIONS.find((e) => e.syncSteps?.includes(step));
export const extensionOfAction = (type: string) => EXTENSIONS.find((e) => e.actions?.includes(type));

/** The plugins an extension needs: the one that brings it, the one it extends, and what else it requires. */
export const extensionNeeds = (e: Extension): PluginId[] => [...new Set([e.by, e.for, ...(e.requires ?? [])])];

/** "from Google Keep" — or "from Google Keep, needs LLM" when it needs more — in the language of `t`. */
export const extensionOrigin = (e: Extension, t: T = translator("en")) => {
  const name = (id: PluginId) => catalogText(t, pluginById(id).name);
  return e.requires?.length ? t("from {plugin}, needs {needs}", { plugin: name(e.by), needs: e.requires.map(name).join(", ") }) : t("from {plugin}", { plugin: name(e.by) });
};
