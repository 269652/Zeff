import { getPref } from "@/lib/prefs";

/**
 * From a connector's built-in to its port (zeff-plugins/plugins/<id>-ext — Teams, WhatsApp, Signal …): the plugin on, its package installed
 * under System — the sync flow, allowed to read its source into Zeff (its `sync` permission: your click is the yes), running as often as the
 * built-in did (by hand only stays by hand) —, the built-in off. Reading the source stays the kernel's driver; everything else of the
 * built-in (its replies, its settings, its pages) keeps working through the port (state.ts PROVIDED_BY). Server only.
 */
export async function switchConnectorToPlugin(builtin: string, opts: { port: string; flow: string; minutes: () => number | Promise<number> }): Promise<{ flow: string }> {
  const reg = await import("@/lib/ext/registry");
  if (!reg.scanPlugins(true).plugins.some((x) => x.id === opts.port)) throw new Error(`The plugin ${opts.port} isn't in the plugins folder — install it from its repository first (Plugins → Sources).`);
  const minutes = await opts.minutes();
  reg.setEnabled(opts.port, true);
  const flows = await import("@/plugins/workspace/flows/store");
  if (!flows.flowByName(opts.flow)) {
    const life = await import("@/plugins/workspace/package-life");
    const pkg = await life.offeredPackage(opts.port);
    if (!pkg) throw new Error(`The plugin ${opts.port} brings no package.`);
    const system = getPref<number | null>("system.root", null);
    const { getPage } = await import("@/plugins/workspace/store");
    await life.installTracked(pkg, system && getPage(system) && !getPage(system)!.archivedAt ? system : null, { allow: true });
  }
  flows.setSyncFlowMinutes(opts.flow, minutes);
  (await import("@/plugins/state")).setInstalled(builtin as never, false);
  return { flow: opts.flow };
}
