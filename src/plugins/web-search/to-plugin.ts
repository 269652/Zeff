import { getSearchConfig } from "./search";

/**
 * From the built-in Web search to the plugin (zeff-plugins/plugins/web-search-ext, docs/plugins/runtime-conversion.md): the provider and
 * keys set here carried over into the plugin's settings (kept encrypted there), the plugin switched on, the built-in switched off. Zeff's
 * web.search and the AI's web_search / web_fetch go on working — the plugin answers them now. Undone by switching the built-in on again
 * (its settings are still there). Needs the plugin in the plugins folder (installed from its repository). Server only.
 */
export const WEB_SEARCH_PLUGIN = "web-search-ext";

export async function switchWebSearchToPlugin(): Promise<{ keys: string[] }> {
  const reg = await import("@/lib/ext/registry");
  const p = reg.scanPlugins(true).plugins.find((x) => x.id === WEB_SEARCH_PLUGIN);
  if (!p) throw new Error(`The Web search plugin (${WEB_SEARCH_PLUGIN}) isn't in the plugins folder — install it from its repository first (Plugins → Sources).`);
  const c = getSearchConfig();
  const values: Record<string, string> = { PROVIDER: c.provider };
  if (c.braveKey) values.BRAVE_KEY = c.braveKey;
  if (c.googleKey) values.GOOGLE_KEY = c.googleKey;
  if (c.googleCx) values.GOOGLE_CX = c.googleCx;
  const { saveSettings } = await import("@/lib/ext/plugin-settings");
  saveSettings(WEB_SEARCH_PLUGIN, p.manifest, values);
  reg.setEnabled(WEB_SEARCH_PLUGIN, true);
  (await import("@/plugins/state")).setInstalled("web-search", false);
  return { keys: Object.keys(values) };
}
