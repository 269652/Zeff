/**
 * From the built-in Correlations to the plugin (zeff-plugins/plugins/correlations-ext): the plugin on, the built-in off. Nothing to carry
 * over: the series are the kernel's, and the port's widget stands in for the built-in's id (`replaces`), so the widgets on your pages
 * go on working. Undone by switching the built-in on again. Server only.
 */
export const CORRELATIONS_PLUGIN = "correlations-ext";

export async function switchCorrelationsToPlugin(): Promise<void> {
  const reg = await import("@/lib/ext/registry");
  if (!reg.scanPlugins(true).plugins.some((x) => x.id === CORRELATIONS_PLUGIN)) throw new Error(`The Correlations plugin (${CORRELATIONS_PLUGIN}) isn't in the plugins folder — install it from its repository first (Plugins → Sources).`);
  reg.setEnabled(CORRELATIONS_PLUGIN, true);
  (await import("@/plugins/state")).setInstalled("correlations", false);
}
