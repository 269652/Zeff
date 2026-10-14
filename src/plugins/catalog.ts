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
export type PluginManifest = Omit<PluginShape<PluginId>, "dependsOn" | "extensions"> & { dependsOn?: PluginId[]; extensions?: import("./extensions").ExtensionDecl[] };

/** Zeff's own plugins, then those of the mounted integrations (src/lib/integrations), each group in the order of its `order`. */
const CORE_PLUGINS = [...BUILTIN_MANIFESTS] as unknown as PluginManifest[];
export const CORE_PLUGIN_IDS: string[] = CORE_PLUGINS.map((p) => p.id);
export const PLUGINS: PluginManifest[] = [...CORE_PLUGINS.sort((a, b) => (a.order ?? 1e6) - (b.order ?? 1e6) || a.id.localeCompare(b.id)), ...integrationManifests()];
export const PLUGIN_IDS = PLUGINS.map((p) => p.id);
export const isPluginId = (v: unknown): v is PluginId => PLUGIN_IDS.includes(v as PluginId);

export const pluginById = (id: PluginId) => PLUGINS.find((p) => p.id === id)!;

/** Steps that need another plugin than their own as well (the mail steps work on todos). */
/**
 * What a sync step needs besides its own plugin — a list in the list: any of them (the Ticket-Lage reads
 * Jira or your Kanban boards, or both; without either, Todos has mails, your own, Work).
 */
export const STEP_NEEDS: Record<string, (PluginId | PluginId[])[]> = { boards: ["llm", ["jira", "kanban"]], recap: ["llm"], mailtodos: ["todos", "llm"], relations: ["todos", "llm"], boardlage: ["jira", "llm"], peoplenorm: ["llm"] };
/** All the plugins that bring a step (Mail: Outlook Mail and Gmail) — any of them installed makes it there. */
export const pluginsOfStep = (key: string) => PLUGINS.filter((p) => p.syncSteps?.includes(key)).map((p) => p.id);
/** All the plugins that own a page. */
export const pluginsOfRoute = (path: string) => PLUGINS.filter((p) => p.routes?.some((r) => path === r || (r !== "/" && path.startsWith(`${r}/`)))).map((p) => p.id);
export const pluginsOfService = (service: string) => PLUGINS.filter((p) => p.services?.includes(service)).map((p) => p.id);
export const pluginOfProvider = (provider: string) => PLUGINS.find((p) => p.aiProvider === provider)?.id ?? null;
