/**
 * Zeff's plugins: the applications (Todos, Work, the weekly and the monthly report), the
 * connectors and drivers (Jira, Outlook mail and calendar, Teams, GitLab), the time-sheet systems
 * (Chrono, Punch) and the AI command-line tools (Copilot CLI, Claude CLI) — installed or not
 * (Menu → Plugins). What a plugin brings is only there while it's installed (and what it builds
 * on is): its tabs, menu entries, pages, syncs, sign-ins, AI provider. For your private life,
 * say, the work ones go and the rest stays. Client-safe (data only).
 */

import { integrationManifests } from "@/lib/integrations/meta";
import { BUILTIN_MANIFESTS } from "./index.generated";
import type { PluginCategory, PluginShape } from "./define";

/** Zeff's own plugins' ids — whatever has a src/plugins/<id>/plugin.ts. */
type CorePluginId = (typeof BUILTIN_MANIFESTS)[number]["id"];
/** A plugin: one of Zeff's own, or one a mounted integration brings (any string — its meta.ts names it). */
export type PluginId = CorePluginId | (string & {});

export type { PluginCategory };
export const PLUGIN_CATEGORY_LABELS: Record<PluginCategory, string> = { app: "Applications", ai: "AI tools", connector: "Connectors", timesheet: "Time-sheet systems", language: "Languages", system: "System" };

/** A plugin's manifest as the rest of Zeff reads it (plugins/define.ts has the fields; ids are checked here). */
export type PluginManifest = Omit<PluginShape<PluginId>, "dependsOn" | "extensions" | "features"> & {
  dependsOn?: PluginId[];
  extensions?: import("./extensions").ExtensionDecl[];
  /** A part of this plugin (its `features`): on or off by itself, there only while the plugin is (it depends on it). */
  partOf?: PluginId;
  /** A part set where it acts, not listed on the Plugins page. */
  hidden?: boolean;
  /** Its parts' ids (each is in PLUGINS too, right after it in the order). */
  features?: PluginId[];
};

/** Shown with every experimental plugin: no warranty, no liability. */
export const EXPERIMENTAL_DISCLAIMER = "No warranty, no liability: Zeff is provided as it is. Automated access can go against the terms of the service or of your employer and can get your account restricted or blocked; it can also read or write wrong data. You use this plugin at your own risk — the author accepts no liability for any damage or consequence of using it.";

/** Zeff's own plugins, then those of the mounted integrations (src/lib/integrations), each group in the order of its `order`. */
const TOP = [...BUILTIN_MANIFESTS] as unknown as (Omit<PluginManifest, "features"> & { features?: (Omit<PluginManifest, "category"> & { category?: never })[] })[];
/** A plugin, then its parts (each depending on it, in its category, ordered by its own order or else the plugin's). */
const withFeatures = (p: (typeof TOP)[number]): PluginManifest[] => [
  { ...p, features: p.features?.map((f) => f.id) },
  ...(p.features ?? []).map((f): PluginManifest => ({ ...f, category: p.category, order: f.order ?? p.order, partOf: p.id, dependsOn: [p.id, ...(f.dependsOn ?? []).filter((d) => d !== p.id)] })),
];
const byOrder = (a: PluginManifest, b: PluginManifest) => (a.order ?? 1e6) - (b.order ?? 1e6) || Number(!!a.partOf) - Number(!!b.partOf) || a.id.localeCompare(b.id);
const CORE_PLUGINS = TOP.flatMap(withFeatures);
/** Zeff's own plugins with a folder each (src/plugins/<id>/plugin.ts) — not their parts. */
export const CORE_PLUGIN_IDS: string[] = TOP.map((p) => p.id);
export const PLUGINS: PluginManifest[] = [...CORE_PLUGINS.sort(byOrder), ...integrationManifests()];
export const PLUGIN_IDS = PLUGINS.map((p) => p.id);
export const isPluginId = (v: unknown): v is PluginId => PLUGIN_IDS.includes(v as PluginId);

export const pluginById = (id: PluginId) => PLUGINS.find((p) => p.id === id)!;
/** The plugins the Plugins page lists (a part is under its plugin there). */
export const listedPlugins = () => PLUGINS.filter((p) => !p.partOf);
/** A plugin's parts, as the Plugins page lists them under it (the hidden ones are set where they act). */
export const featuresOf = (id: PluginId) => PLUGINS.filter((p) => p.partOf === id && !p.hidden);

/** Steps that need another plugin than their own as well (the mail steps work on todos). */
/**
 * What a sync step needs besides its own plugin — a list in the list: any of them (the Ticket-Lage reads
 * Jira or your Kanban boards, or both; without either, Todos has mails, your own, Work).
 */
export const STEP_NEEDS: Record<string, (PluginId | PluginId[])[]> = { boards: ["llm", ["jira", "workspace"]], recap: ["llm"], mailtodos: ["todos", "llm"], relations: ["todos", "llm"], boardlage: ["jira", "llm"], peoplenorm: ["llm"] };
/** All the plugins that bring a step (Mail: Outlook Mail and Gmail) — any of them installed makes it there. */
export const pluginsOfStep = (key: string) => PLUGINS.filter((p) => p.syncSteps?.includes(key)).map((p) => p.id);
export const pluginsOfService = (service: string) => PLUGINS.filter((p) => p.services?.includes(service)).map((p) => p.id);
export const pluginOfProvider = (provider: string) => PLUGINS.find((p) => p.aiProvider === provider)?.id ?? null;
