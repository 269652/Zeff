import { PLUGINS, type PluginId, type PluginManifest } from "./catalog";
import { integrationServer, integrationServerIds } from "@/lib/integrations/server";
import { stepExtensionOk } from "./extension-state";
import { installedPlugins } from "./state";
import type { PluginSyncSettings, SyncInterval } from "./sync-settings";
import { syncSettings as autoActions } from "./auto-actions/sync-settings";
import { syncSettings as backup } from "./backup/sync-settings";
import { syncSettings as gitlab } from "./gitlab/sync-settings";
import { syncSettings as gmail } from "./gmail/sync-settings";
import { syncSettings as imapMail } from "./imap-mail/sync-settings";
import { syncSettings as jira } from "./jira/sync-settings";
import { syncSettings as jiraLage } from "./jira-lage/sync-settings";
import { syncSettings as calendar } from "./calendar/sync-settings";
import { syncSettings as outlookCalendar } from "./outlook/calendar-sync-settings";
import { syncSettings as outlookMail } from "./outlook/mail-sync-settings";
import { syncSettings as teams } from "./teams/sync-settings";
import { syncSettings as todos } from "./todos/sync-settings";
import { syncSettings as whatsapp } from "./whatsapp/sync-settings";
import { syncSettings as signal } from "./signal/sync-settings";
import { syncSettings as knowledge } from "./knowledge/sync-settings";
import { syncSettings as keep } from "./keep/sync-settings";
import { syncSettings as documents } from "./documents/sync-settings";
import { syncSettings as googleCalendar } from "./google-calendar/sync-settings";
import { syncSettings as googleDrive } from "./google-drive/sync-settings";
import { onlyThroughPort } from "./state";
import { flowByName, listFlows, setSyncFlowMinutes } from "./workspace/flows/store";
import { syncSettings as news } from "./news/sync-settings";

/** Each plugin's settings module for the Sync settings page — the plugins that bring a sync. */
const modules = (): Partial<Record<PluginId, PluginSyncSettings>> => ({
  documents,
  news,
  todos,
  knowledge,
  "auto-actions": autoActions,
  "jira-lage": jiraLage,
  jira,
  teams,
  "outlook-mail": outlookMail,
  gmail,
  "imap-mail": imapMail,
  whatsapp,
  signal,
  keep,
  "google-calendar": googleCalendar,
  "google-drive": googleDrive,
  calendar,
  "outlook-calendar": outlookCalendar,
  gitlab,
  backup,
  // The mounted integrations' (Chrono, Punch).
  ...Object.fromEntries(integrationServerIds().flatMap((id) => { const s = integrationServer(id)?.syncSettings; return s ? [[id, s]] : []; })),
});

/**
 * The installed plugins' sync settings, in the catalog's order — a sync two plugins share (Mail:
 * Outlook Mail and Gmail) under the first of them only.
 */
export function installedSyncSettings(): { plugin: PluginManifest; settings: Required<PluginSyncSettings> }[] {
  const on = installedPlugins();
  const MODULES = modules();
  const seen = new Set<string>();
  const out: { plugin: PluginManifest; settings: Required<PluginSyncSettings> }[] = [];
  for (const plugin of PLUGINS) {
    const m = on.has(plugin.id) ? MODULES[plugin.id] : undefined;
    if (!m) continue;
    // (a built-in there only through its port: its steps are the port's sync flows — their intervals in their place)
    const intervals = (m.intervals ?? []).filter((i) => !seen.has(i.key) && stepExtensionOk(i.key)).flatMap((i) => (onlyThroughPort(plugin.id) ? portIntervals(i) : [i]));
    // A step an extension brings (Keep's Notiz-Durchsicht) only while it's on.
    const follows = (m.follows ?? []).filter((f) => !seen.has(f.key) && stepExtensionOk(f.key));
    for (const x of [...intervals, ...follows]) seen.add(x.key);
    if (intervals.length || follows.length) out.push({ plugin, settings: { intervals, follows } });
  }
  return out;
}

/**
 * The sync flows that stand for a built-in's step (FlowDef.sync.replaces — a port's: Google Calendar's) as the Sync settings page's
 * intervals: how often each runs by itself is its schedule trigger (0: only by hand).
 */
function portIntervals(i: SyncInterval): SyncInterval[] {
  return listFlows()
    .filter((f) => f.sync?.replaces === i.key && f.enabled !== false)
    .map((f): SyncInterval => ({
      key: `flow:${f.name}`,
      label: f.sync!.label,
      what: f.sync!.what ?? i.what,
      choices: i.choices,
      ...(i.window ? { window: i.window } : {}),
      get: () => (flowByName(f.name)?.triggers.find((x) => x.kind === "schedule") as { everyMinutes?: number } | undefined)?.everyMinutes ?? 0,
      set: (minutes) => setSyncFlowMinutes(f.name, minutes),
    }));
}

/** An installed plugin's sync by its key — what the page may set. */
export function findSyncInterval(key: string): SyncInterval | null {
  for (const { settings } of installedSyncSettings()) {
    const i = settings.intervals.find((x) => x.key === key);
    if (i) return i;
  }
  return null;
}
