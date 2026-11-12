/**
 * The one way the Workspace runs a function a plugin brings (flows, widgets, the plugins' lookups and sources): the Notebook plugin must be
 * there, the function runs with what the user granted it, and a failure is an Error saying why. The permission to *ask* for it
 * (a flow's, a widget's) is checked by the caller. Server only.
 */

/** Arguments from anything a caller passed: a plain object, else none. */
export const asArgs = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export async function runPluginFunction(plugin: string, name: string, args: unknown = {}): Promise<unknown> {
  if (!(await import("@/plugins/state")).isInstalled("notebook")) throw new Error("The Notebook plugin is not installed (it runs the plugin's functions).");
  const { callFunction } = await import("@/plugins/notebook/functions");
  const r = await callFunction(plugin, name, asArgs(args));
  if (!r.ok) throw new Error(r.error);
  return r.value ?? null;
}
