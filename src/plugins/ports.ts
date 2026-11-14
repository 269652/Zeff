/**
 * The built-in plugins that have a port in the plugins repository (docs/plugins/runtime-conversion.md): which external plugin replaces
 * each and how you switch to it. The Plugins page offers *Switch to the plugin* on the built-in's card when the port is in the plugins
 * folder. A built-in leaves Zeff's code only once its port is 1:1 and you switched. Server only.
 */
export type Port = { builtin: string; plugin: string; switch: () => Promise<unknown> };

/** How often a built-in step synced (the Sync settings) — its port's flow takes it over. */
const stepMinutesOf = (key: string) => async () => (await import("@/lib/sync/intervals")).stepMinutes(key as never);

export const PORTS: Port[] = [
  { builtin: "lookups", plugin: "lookups-ext", switch: async () => (await import("./lookups/to-plugin")).switchLookupsToPlugin() },
  { builtin: "web-search", plugin: "web-search-ext", switch: async () => (await import("./web-search/to-plugin")).switchWebSearchToPlugin() },
  { builtin: "browser", plugin: "browser-ext", switch: async () => (await import("./browser/to-plugin")).switchBrowserToPlugin() },
  { builtin: "correlations", plugin: "correlations-ext", switch: async () => (await import("./correlations/to-plugin")).switchCorrelationsToPlugin() },
  { builtin: "agenda", plugin: "agenda-ext", switch: async () => (await import("./agenda/to-plugin")).switchAgendaToPlugin() },
  { builtin: "mail-client", plugin: "mail-client-ext", switch: async () => (await import("./mail-client/to-plugin")).switchMailClientToPlugin() },
  { builtin: "teams", plugin: "teams-ext", switch: async () => (await import("./connector-port")).switchConnectorToPlugin("teams", { port: "teams-ext", flow: "teams.sync", minutes: async () => (await import("@/lib/teams/store")).getTeamsSettings().syncMinutes }) },
  { builtin: "whatsapp", plugin: "whatsapp-ext", switch: async () => (await import("./connector-port")).switchConnectorToPlugin("whatsapp", { port: "whatsapp-ext", flow: "whatsapp.sync", minutes: stepMinutesOf("whatsapp") }) },
  { builtin: "signal", plugin: "signal-ext", switch: async () => (await import("./connector-port")).switchConnectorToPlugin("signal", { port: "signal-ext", flow: "signal.sync", minutes: stepMinutesOf("signal") }) },
  { builtin: "local-ai", plugin: "local-ai-ext", switch: async () => (await import("./local-ai/to-plugin")).switchLocalAiToPlugin() },
  { builtin: "google-calendar", plugin: "google-calendar-ext", switch: async () => (await import("./google-calendar/to-plugin")).switchGoogleCalendarToPlugin() },
];

/** The port of a built-in, when there is one and it is in the plugins folder (installed from its repository). */
export async function portOf(builtin: string): Promise<Port | null> {
  const port = PORTS.find((p) => p.builtin === builtin);
  if (!port) return null;
  const { scanPlugins } = await import("@/lib/ext/registry");
  return scanPlugins().plugins.some((p) => p.id === port.plugin) ? port : null;
}
