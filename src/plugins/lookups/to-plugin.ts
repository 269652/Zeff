import { getLookupConfig } from "./config";

/**
 * From the built-in Lookups to the plugin (zeff-plugins/plugins/lookups-ext, docs/plugins/runtime-conversion.md): the keys you set
 * here carried over into the plugin's settings (kept encrypted there), the plugin switched on, the built-in switched off. Your views keep
 * working as they are — the sources keep their names. Undone by switching the built-in on again (its keys are still there). Needs the
 * plugin in the plugins folder (installed from its repository). Server only.
 */
export const LOOKUPS_PLUGIN = "lookups-ext";

export async function switchLookupsToPlugin(): Promise<{ keys: string[] }> {
  const reg = await import("@/lib/ext/registry");
  const p = reg.scanPlugins(true).plugins.find((x) => x.id === LOOKUPS_PLUGIN);
  if (!p) throw new Error(`The Lookups plugin (${LOOKUPS_PLUGIN}) isn't in the plugins folder — install it from its repository first (Plugins → Sources).`);
  const c = getLookupConfig();
  const values: Record<string, string> = {};
  if (c.tmdbKey) values.TMDB_KEY = c.tmdbKey;
  if (c.googleKey) values.GOOGLE_KEY = c.googleKey;
  const { saveSettings } = await import("@/lib/ext/plugin-settings");
  saveSettings(LOOKUPS_PLUGIN, p.manifest, values);
  reg.setEnabled(LOOKUPS_PLUGIN, true);
  (await import("@/plugins/state")).setInstalled("lookups", false);
  return { keys: Object.keys(values) };
}
