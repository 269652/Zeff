/**
 * Extensions — plugins for plugins: what one plugin brings to another (Google Keep brings Auto-
 * Aktionen a "Notiz anlegen" action, Todos a Notiz-Durchsicht, the Ticket-Lage your notes). Each is
 * declared by the plugin that brings it (its manifest's `extensions`) and is there only while that
 * plugin, the one it extends and whatever else it needs are installed. Then it's on or off as you
 * set it (Plugins page, under the plugin it extends) — some are on by themselves (`defaultInstalled`)
 * the moment their plugins are there. What it brings (sync steps, actions) goes with it. Client-safe.
 */
import { PLUGINS, pluginById, type PluginId } from "./catalog";

/** An extension as its plugin declares it. */
export type ExtensionDecl = {
  /** Unique within the plugin that brings it ("note-action"). */
  key: string;
  /** The plugin it extends. */
  for: PluginId;
  name: string;
  description: string;
  /** More plugins it needs (besides the one that brings it and the one it extends). */
  requires?: PluginId[];
  /** On by itself once its plugins are there (until you turn it off). */
  defaultInstalled: boolean;
  /** The sync steps it brings — there only while it's on. */
  syncSteps?: string[];
  /** The actions (operation types) it brings — offered and run only while it's on. */
  actions?: string[];
};

export type Extension = ExtensionDecl & {
  /** "<by>:<key>" — "keep:note-action". */
  id: string;
  /** The plugin that brings it. */
  by: PluginId;
};

export const EXTENSIONS: Extension[] = PLUGINS.flatMap((p) => (p.extensions ?? []).map((e): Extension => ({ ...e, id: `${p.id}:${e.key}`, by: p.id })));

export const extensionById = (id: string) => EXTENSIONS.find((e) => e.id === id);
/** The extensions a plugin gets (from whichever plugins bring them). */
export const extensionsFor = (host: PluginId) => EXTENSIONS.filter((e) => e.for === host);
/** The extension a sync step / an action belongs to (none: the plugin's own). */
export const extensionOfStep = (step: string) => EXTENSIONS.find((e) => e.syncSteps?.includes(step));
export const extensionOfAction = (type: string) => EXTENSIONS.find((e) => e.actions?.includes(type));

/** The plugins an extension needs: the one that brings it, the one it extends, and what else it requires. */
export const extensionNeeds = (e: Extension): PluginId[] => [...new Set([e.by, e.for, ...(e.requires ?? [])])];

/** "von Google Keep" — or "von Google Keep, braucht LLM" when it needs more. */
export const extensionOrigin = (e: Extension) => `von ${pluginById(e.by).name}${e.requires?.length ? `, braucht ${e.requires.map((r) => pluginById(r).name).join(", ")}` : ""}`;
