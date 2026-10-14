import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import { setEventCheck, setPermissionCheck } from "@/lib/ext/manifest";
import type { ApiContribution, ApiEvent } from "./api-kit";

/** The `api.methods` extension point, on its own so a plugin's server.ts can register without loading the registry that loads all server.ts files. */
export const apiPoint = extensionPoint<ApiContribution>("api.methods");

const ids = new WeakMap<ApiContribution, string[]>();

/** Every permission id any plugin brings, installed or not (a manifest may ask for one of a plugin that is off for now). */
export function allPermissionIds(): string[] {
  return apiPoint.all().flatMap((c) => {
    let list = ids.get(c.impl);
    if (!list) ids.set(c.impl, (list = Object.keys(c.impl.permissions?.() ?? {})));
    return list;
  });
}

// A manifest naming a permission nobody brings is refused (a typo) — but only once Zeff's own are registered.
setPermissionCheck((p) => !apiPoint.all().some((c) => c.plugin === "core") || allPermissionIds().includes(p));

/** Every event any plugin brings, installed or not, with the plugin that brings it. */
export const allEvents = (): (ApiEvent & { id: string; plugin: string })[] => apiPoint.all().flatMap((c) => Object.entries(c.impl.events ?? {}).map(([id, e]) => ({ ...e, id, plugin: c.plugin })));

// The same for the events a hook may name.
setEventCheck((e) => !apiPoint.all().some((c) => c.plugin === "core") || allEvents().some((x) => x.id === e));
