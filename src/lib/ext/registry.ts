import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { BASE_DIR, currentAccountId } from "@/db/accounts";
import { getDb, schema } from "@/db";
import { getPref, setPref } from "@/lib/prefs";
import { safeMode } from "@/lib/kernel/safe-mode";
import { parseManifest, type Manifest, type Permission } from "./manifest";
// The permissions a manifest may ask for are the ones the plugins bring: they register when this is loaded.
import "@/lib/plugins/api";

/**
 * The external plugins on this computer: every folder in the plugins folder with a valid
 * zeff-plugin.json. Found again on every look (cached for 1.5 s), so a plugin you drop in, edit or
 * delete is there — or gone — without restarting Zeff. Whether one is on is per account (the
 * plugins table, row "x:<id>"), and so are the permissions you granted it.
 */

/** <data>/plugins — or ZEFF_PLUGINS_DIR. */
export const pluginsRoot = (): string => (process.env.ZEFF_PLUGINS_DIR ? path.resolve(/*turbopackIgnore: true*/ process.env.ZEFF_PLUGINS_DIR) : path.join(/*turbopackIgnore: true*/ BASE_DIR, "plugins"));

export type FoundPlugin = {
  id: string;
  dir: string;
  manifest: Manifest;
};
export type Problem = { dir: string; error: string };
export type Scan = { plugins: FoundPlugin[]; problems: Problem[] };

type Cache = { at: number; root: string; scan: Scan };
const g = globalThis as { __zeffExtScan?: Cache };
const TTL = 1500;

/** All plugin folders, valid ones and what's wrong with the others. */
export function scanPlugins(force = false): Scan {
  const root = pluginsRoot();
  const c = g.__zeffExtScan;
  if (!force && c && c.root === root && Date.now() - c.at < TTL) return c.scan;
  const scan: Scan = { plugins: [], problems: [] };
  let names: string[] = [];
  try {
    names = fs.readdirSync(/*turbopackIgnore: true*/ root, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("_") && !e.name.endsWith(".bak")).map((e) => e.name);
  } catch {
    // no plugins folder: no plugins
  }
  const seen = new Set<string>();
  for (const name of names.sort()) {
    const dir = path.join(/*turbopackIgnore: true*/ root, name);
    let text: string;
    try {
      text = fs.readFileSync(/*turbopackIgnore: true*/ path.join(dir, "zeff-plugin.json"), "utf8");
    } catch {
      scan.problems.push({ dir: name, error: "no zeff-plugin.json" });
      continue;
    }
    const r = parseManifest(text);
    if (!r.ok) scan.problems.push({ dir: name, error: r.error });
    else if (r.manifest.id !== name) scan.problems.push({ dir: name, error: `the folder must be named like the plugin's id ("${r.manifest.id}")` });
    else if (seen.has(r.manifest.id)) scan.problems.push({ dir: name, error: "this id is used twice" });
    else {
      seen.add(r.manifest.id);
      scan.plugins.push({ id: r.manifest.id, dir, manifest: r.manifest });
    }
  }
  g.__zeffExtScan = { at: Date.now(), root, scan };
  return scan;
}

const stateKey = (id: string) => `x:${id}`;
const grantKey = (id: string) => `ext:granted:${id}`;

/** On for the account this runs for? (Off unless you turned it on — and off for all while Zeff is in safe mode: lib/kernel/safe-mode.ts.) */
export function isEnabled(id: string): boolean {
  if (safeMode()) return false;
  return !!getDb().select({ installed: schema.plugins.installed }).from(schema.plugins).where(eq(schema.plugins.id, stateKey(id))).get()?.installed;
}

/** What you granted a plugin when you turned it on (what its manifest asked for then). */
export const grantedPermissions = (id: string): Permission[] => getPref<Permission[]>(grantKey(id), []);

/** Turn a plugin on — granting what its manifest asks for now — or off. */
export function setEnabled(id: string, on: boolean): void {
  const found = scanPlugins(true).plugins.find((p) => p.id === id);
  if (on && !found) throw new Error(`No plugin "${id}" in ${pluginsRoot()}.`);
  const now = new Date().toISOString();
  getDb()
    .insert(schema.plugins)
    .values({ id: stateKey(id), installed: on, changedAt: now })
    .onConflictDoUpdate({ target: schema.plugins.id, set: { installed: on, changedAt: now } })
    .run();
  if (on && found) setPref(grantKey(id), found.manifest.permissions);
}

/** A plugin as the rest of Zeff sees it: found, on or not, what it may do. */
export type ExtPlugin = FoundPlugin & {
  enabled: boolean;
  /** Its manifest ∩ what you granted: what it can actually do. */
  permissions: Set<Permission>;
  /** Asks for more now than you granted (it was updated): those are held back until you turn it on again. */
  ungranted: Permission[];
};

export function describePlugin(p: FoundPlugin): ExtPlugin {
  const enabled = isEnabled(p.id);
  const granted = new Set(grantedPermissions(p.id));
  const asked = p.manifest.permissions;
  return { ...p, enabled, permissions: new Set(enabled ? asked.filter((x) => granted.has(x)) : []), ungranted: enabled ? asked.filter((x) => !granted.has(x)) : [] };
}

/** Every plugin found, as {@link describePlugin} says. */
export const allPlugins = (): ExtPlugin[] => scanPlugins().plugins.map(describePlugin);

/** The plugins that are on (for the current account). */
export const enabledPlugins = (): ExtPlugin[] => allPlugins().filter((p) => p.enabled);

export function getPlugin(id: string): ExtPlugin | undefined {
  const f = scanPlugins().plugins.find((p) => p.id === id);
  return f && describePlugin(f);
}

/** The account the current code runs for (what hooks and the API tell plugins). */
export const accountOf = (): string => currentAccountId();
