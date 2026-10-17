import "@/plugins/contributions";
import { apiMethods, builtinCaller, callApi } from "@/lib/plugins/api";

/**
 * What an automation's "call" step may call: the plugins' API methods that are marked safe for automations (they work inside Zeff
 * only — a row, a todo, a signal — and send nothing out). Anything else is refused, however it is named.
 */
export type AutomaticMethod = { name: string; plugin: string; label: string; summary: string; fields: Record<string, string> };

export function automaticMethods(): AutomaticMethod[] {
  return Object.entries(apiMethods())
    .filter(([, m]) => m.automatic)
    .map(([name, m]) => ({ name, plugin: m.plugin, label: m.offer?.label ?? name, summary: m.summary, fields: m.offer?.fields ?? {} }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A method called by an automation step: its parameters are texts. The answer is what the method returned. */
export async function callAutomatic(name: string, params: Record<string, string>): Promise<unknown> {
  const m = apiMethods()[name];
  if (!m) throw new Error(`There is no method “${name}”.`);
  if (!m.automatic) throw new Error(`The method “${name}” is not allowed in automations.`);
  const r = await callApi(builtinCaller("workspace"), name, params);
  if (!r.ok) throw new Error(r.error.message);
  return r.result;
}
