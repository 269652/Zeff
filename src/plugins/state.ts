import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { accountsInstalled, currentAccountId, setAccountsInstalled } from "@/db/accounts";
import { emitChange } from "@/lib/events";
import { stepExtensionOk } from "./extension-state";
import { PLUGINS, STEP_NEEDS, isPluginId, pluginById, pluginOfProvider, pluginsOfStep, pluginsOfService, type PluginId } from "./catalog";

/** Each plugin as you set it (the plugins table), else its default — not yet looking at what it builds on. */
function chosen(): Map<PluginId, boolean> {
  const set = new Map(getDb().select().from(schema.plugins).all().filter((r) => isPluginId(r.id)).map((r) => [r.id as PluginId, r.installed]));
  // Accounts: for all of them alike (else, in another account, there'd be no way back).
  return new Map(PLUGINS.map((p) => [p.id, p.id === "accounts" ? accountsInstalled() : (set.get(p.id) ?? p.defaultInstalled)]));
}

/**
 * What's installed, per account, for a moment: a page asks isInstalled() a dozen times and more —
 * once is enough. Dropped on every install/uninstall here, so a change still shows at once.
 */
const memo = globalThis as unknown as { __zeffInstalled?: Map<string, { at: number; set: Set<PluginId> }> };
const installedMemo = (memo.__zeffInstalled ??= new Map());
const MEMO_MS = 2000;
const forgetInstalled = () => installedMemo.clear();

/**
 * Which plugins are there: installed (as you set them, else their default) and so is everything
 * they build on (Work on Todos, Todos on Jira).
 */
export function installedPlugins(): Set<PluginId> {
  const account = currentAccountId();
  const hit = installedMemo.get(account);
  if (hit && Date.now() - hit.at < MEMO_MS) return new Set(hit.set);
  const set = readInstalled();
  installedMemo.set(account, { at: Date.now(), set });
  return new Set(set);
}

function readInstalled(): Set<PluginId> {
  const on = chosen();
  // `path`: the plugins on the way here — a cycle guard per path (a plugin two of its dependencies share is there for both).
  const there = (id: PluginId, path = new Set<PluginId>()): boolean => {
    if (!on.get(id) || path.has(id)) return false;
    const next = new Set(path).add(id);
    return (pluginById(id).dependsOn ?? []).every((d) => there(d, next));
  };
  return new Set(PLUGINS.filter((p) => there(p.id)).map((p) => p.id));
}

/** As you set it, whatever it builds on (the Plugins page shows both). */
export const chosenPlugins = () => new Set([...chosen()].filter(([, v]) => v).map(([k]) => k));

/** Installed. */
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
  forgetInstalled();
  if (id === "accounts") {
    setAccountsInstalled(installed);
    emitChange("attention");
    return ids;
  }
  for (const x of ids) getDb().insert(schema.plugins).values({ id: x, installed, changedAt }).onConflictDoUpdate({ target: schema.plugins.id, set: { installed, changedAt } }).run();
  forgetInstalled();
  emitChange("attention");
  return ids;
}

/**
 * Plugins that went, as you had set them (the plugins table): Kanban and Notes are the Workspace's now — their choice goes to it
 * where the Workspace has none of its own; Keep write is gone. Their rows go. Once per account (lib/once-done). How many rows went.
 */
export const RETIRED_PLUGINS_ONCE = "plugins.retiredIds@1";
const RETIRED: Record<string, PluginId | null> = { kanban: "workspace", notes: "workspace", "keep-write": null };
export function rewriteRetiredPlugins(): number {
  const rows = getDb().select().from(schema.plugins).all();
  const has = new Set(rows.map((r) => r.id));
  let n = 0;
  for (const r of rows) {
    if (!(r.id in RETIRED)) continue;
    const to = RETIRED[r.id];
    if (to && !has.has(to)) {
      getDb().insert(schema.plugins).values({ id: to, installed: r.installed, changedAt: r.changedAt }).run();
      has.add(to);
    }
    getDb().delete(schema.plugins).where(eq(schema.plugins.id, r.id)).run();
    n++;
  }
  forgetInstalled();
  return n;
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
export const serviceAvailable = (service: string) => {
  const ps = pluginsOfService(service);
  return !ps.length || ps.some((p) => isInstalled(p));
};
export const providerAvailable = (provider: string) => {
  const p = pluginOfProvider(provider);
  return !p || isInstalled(p);
};
