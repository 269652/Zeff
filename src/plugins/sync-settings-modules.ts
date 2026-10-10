import { PLUGINS, type PluginId, type PluginManifest } from "./catalog";
import { stepExtensionOk } from "./extension-state";
import { installedPlugins } from "./state";
import type { PluginSyncSettings, SyncInterval } from "./sync-settings";
import { syncSettings as autoActions } from "./auto-actions/sync-settings";
import { syncSettings as backup } from "./backup/sync-settings";
import { syncSettings as gitlab } from "./gitlab/sync-settings";
import { syncSettings as gmail } from "./gmail/sync-settings";
import { syncSettings as jira } from "./jira/sync-settings";
import { syncSettings as jiraLage } from "./jira-lage/sync-settings";
import { syncSettings as outlookCalendar } from "./outlook-calendar/sync-settings";
import { syncSettings as outlookMail } from "./outlook-mail/sync-settings";
import { syncSettings as chrono } from "./chrono/sync-settings";
import { syncSettings as teams } from "./teams/sync-settings";
import { syncSettings as punch } from "./punch/sync-settings";
import { syncSettings as todos } from "./todos/sync-settings";
import { syncSettings as whatsapp } from "./whatsapp/sync-settings";
import { syncSettings as keep } from "./keep/sync-settings";

/** Each plugin's settings module for the Sync settings page — the plugins that bring a sync. */
const MODULES: Partial<Record<PluginId, PluginSyncSettings>> = {
  todos,
  "auto-actions": autoActions,
  "jira-lage": jiraLage,
  jira,
  teams,
  "outlook-mail": outlookMail,
  gmail,
  whatsapp,
  keep,
  "outlook-calendar": outlookCalendar,
  gitlab,
  chrono,
  punch,
  backup,
};

/**
 * The installed plugins' sync settings, in the catalog's order — a sync two plugins share (Mail:
 * Outlook Mail and Gmail) under the first of them only.
 */
export function installedSyncSettings(): { plugin: PluginManifest; settings: Required<PluginSyncSettings> }[] {
  const on = installedPlugins();
  const seen = new Set<string>();
  const out: { plugin: PluginManifest; settings: Required<PluginSyncSettings> }[] = [];
  for (const plugin of PLUGINS) {
    const m = on.has(plugin.id) ? MODULES[plugin.id] : undefined;
    if (!m) continue;
    const intervals = (m.intervals ?? []).filter((i) => !seen.has(i.key));
    // A step an extension brings (Keep's Notiz-Durchsicht) only while it's on.
    const follows = (m.follows ?? []).filter((f) => !seen.has(f.key) && stepExtensionOk(f.key));
    for (const x of [...intervals, ...follows]) seen.add(x.key);
    if (intervals.length || follows.length) out.push({ plugin, settings: { intervals, follows } });
  }
  return out;
}

/** An installed plugin's sync by its key — what the page may set. */
export function findSyncInterval(key: string): SyncInterval | null {
  for (const { settings } of installedSyncSettings()) {
    const i = settings.intervals.find((x) => x.key === key);
    if (i) return i;
  }
  return null;
}
