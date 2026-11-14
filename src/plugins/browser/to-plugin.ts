/**
 * From the built-in Browser to the plugin (zeff-plugins/plugins/browser-ext, docs/plugins/runtime-conversion.md): the plugin switched on —
 * which grants it the `browser` permission it asks for, as the built-in had it —, the built-in switched off. The AI's browser_open goes on
 * working, answered by the plugin through the kernel's Chrome. Undone by switching the built-in on again. Needs the plugin in the plugins
 * folder (installed from its repository). Server only.
 */
export const BROWSER_PLUGIN = "browser-ext";

export async function switchBrowserToPlugin(): Promise<void> {
  const reg = await import("@/lib/ext/registry");
  const p = reg.scanPlugins(true).plugins.find((x) => x.id === BROWSER_PLUGIN);
  if (!p) throw new Error(`The Browser plugin (${BROWSER_PLUGIN}) isn't in the plugins folder — install it from its repository first (Plugins → Sources).`);
  reg.setEnabled(BROWSER_PLUGIN, true);
  (await import("@/plugins/state")).setInstalled("browser", false);
}
