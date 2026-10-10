import { getDb, schema } from "@/db";
import { accountsInstalled, setAccountsInstalled } from "@/db/accounts";
import { emitChange } from "@/lib/events";
import { stepExtensionOk } from "./extension-state";
import { PLUGINS, STEP_NEEDS, isPluginId, pluginById, pluginOfProvider, pluginsOfRoute, pluginsOfStep, pluginsOfService, type PluginId } from "./catalog";

/** Each plugin as you set it (the plugins table), else its default — not yet looking at what it builds on. */
function chosen(): Map<PluginId, boolean> {
  const set = new Map(getDb().select().from(schema.plugins).all().filter((r) => isPluginId(r.id)).map((r) => [r.id as PluginId, r.installed]));
  // Accounts: for all of them alike (else, in another account, there'd be no way back).
  return new Map(PLUGINS.map((p) => [p.id, p.id === "accounts" ? accountsInstalled() : (set.get(p.id) ?? p.defaultInstalled)]));
}

/**
 * Which plugins are there: installed (as you set them, else their default) and so is everything
 * they build on (Work on Todos, Todos on Jira). Read fresh each time — a change shows at once.
 */
export function installedPlugins(): Set<PluginId> {
  const on = chosen();
  const there = (id: PluginId, seen = new Set<PluginId>()): boolean => {
    if (!on.get(id) || seen.has(id)) return false;
    seen.add(id);
    return (pluginById(id).dependsOn ?? []).every((d) => there(d, seen));
  };
  return new Set(PLUGINS.filter((p) => there(p.id)).map((p) => p.id));
}

/** As you set it, whatever it builds on (the Plugins page shows both). */
export const chosenPlugins = () => new Set([...chosen()].filter(([, v]) => v).map(([k]) => k));

export const isInstalled = (id: PluginId) => installedPlugins().has(id);

/** The installed plugins that build on this one, directly or not (they go with it). */
export function dependents(id: PluginId): PluginId[] {
  const set = chosen();
  const out: PluginId[] = [];
  const walk = (x: PluginId) => {
    for (const p of PLUGINS) {
      if (!p.dependsOn?.includes(x) || !set.get(p.id) || out.includes(p.id)) continue;
      out.push(p.id);
      walk(p.id);
    }
  };
  walk(id);
  return out;
}

/**
 * Install or uninstall one — installing also installs what it builds on. Its data stays (mails,
 * messages, todos, pulled entries) — only what it does goes.
 */
export function setInstalled(id: PluginId, installed: boolean): PluginId[] {
  const changedAt = new Date().toISOString();
  const ids: PluginId[] = [id];
  if (installed) {
    const need = (x: PluginId) => {
      for (const d of pluginById(x).dependsOn ?? []) {
        if (ids.includes(d)) continue;
        ids.push(d);
        need(d);
      }
    };
    need(id);
  }
  if (id === "accounts") {
    setAccountsInstalled(installed);
    emitChange("attention");
    return ids;
  }
  for (const x of ids) getDb().insert(schema.plugins).values({ id: x, installed, changedAt }).onConflictDoUpdate({ target: schema.plugins.id, set: { installed, changedAt } }).run();
  emitChange("attention");
  return ids;
}

/** A sync step / page / service / AI provider of an installed plugin (or Zeff's own) — usable. */
export const stepAvailable = (key: string) => {
  const ps = pluginsOfStep(key);
  const on = installedPlugins();
  return (
    (!ps.length || ps.some((p) => on.has(p))) &&
    (STEP_NEEDS[key] ?? []).every((n) => (Array.isArray(n) ? n.some((x) => on.has(x)) : on.has(n))) &&
    // A step an extension brings: only while it's on (its plugins there).
    stepExtensionOk(key)
  );
};
export const routeAvailable = (path: string) => {
  const ps = pluginsOfRoute(path);
  return !ps.length || ps.some((p) => isInstalled(p));
};
export const serviceAvailable = (service: string) => {
  const ps = pluginsOfService(service);
  return !ps.length || ps.some((p) => isInstalled(p));
};
export const providerAvailable = (provider: string) => {
  const p = pluginOfProvider(provider);
  return !p || isInstalled(p);
};
