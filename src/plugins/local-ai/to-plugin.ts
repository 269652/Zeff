import { getPref } from "@/lib/prefs";

const PORT = "local-ai-ext";

/** The page the port's package made (its settings block on it) — null: not installed (or gone). */
export async function localAiPortPage(): Promise<number | null> {
  const { getInstalled } = await import("@/plugins/workspace/package-registry");
  const id = getInstalled(PORT)?.rootId ?? null;
  if (!id) return null;
  const { getPage } = await import("@/plugins/workspace/store");
  const p = getPage(id);
  return p && !p.archivedAt ? id : null;
}

/**
 * From the built-in Local AI to the plugin (zeff-plugins/plugins/local-ai-ext): the plugin on, its package installed under System — the
 * page "Local AI" with its settings block —, the built-in off. Talking to the model stays the kernel's driver (lib/ai/local); your address,
 * model and choices stay, and everything that asks for the local AI keeps finding it (state.ts PROVIDED_BY). Settings → Local AI opens
 * the plugin's page then. Server only.
 */
export async function switchLocalAiToPlugin(): Promise<{ page: number }> {
  const reg = await import("@/lib/ext/registry");
  if (!reg.scanPlugins(true).plugins.some((x) => x.id === PORT)) throw new Error(`The Local AI plugin (${PORT}) isn't in the plugins folder — install it from its repository first (Plugins → Sources).`);
  reg.setEnabled(PORT, true);
  let page = await localAiPortPage();
  if (!page) {
    const life = await import("@/plugins/workspace/package-life");
    const pkg = await life.offeredPackage(PORT);
    if (!pkg) throw new Error(`The Local AI plugin (${PORT}) brings no package.`);
    const system = getPref<number | null>("system.root", null);
    const { getPage } = await import("@/plugins/workspace/store");
    page = (await life.installTracked(pkg, system && getPage(system) && !getPage(system)!.archivedAt ? system : null)).rootId;
  }
  (await import("@/plugins/state")).setInstalled("local-ai", false);
  return { page };
}
