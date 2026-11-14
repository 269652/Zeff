import fs from "node:fs";
import path from "node:path";
import { activeAccountId, withAccount } from "@/db/accounts";
import { getPref, setPref } from "@/lib/prefs";
import { packagesFilePath, readPackagesFile, sourceNameFor, writePackagesFile, type PackagesFile } from "./packages-file";
import { pluginsRoot, scanPlugins } from "./registry";
import { checkAll, checkSource, installFromSource, origin, pendingMerges, sourceByUrl, updateNotes } from "./sources";

/**
 * packages.json kept and followed (packages-file.ts): a running Zeff watches the file and, when it changed, brings every plugin it lists to
 * the place it names — installed, or reinstalled from a new repository (merged with what was changed here; conflicts wait for the
 * person). Plugins it doesn't list are left as they are (said, never removed). Every half hour, and when asked, the sources are checked for
 * newer versions: what is found becomes the update notes the app shows, with the commits since the version installed. What it did and
 * found is kept beside the plugins (.packages-state.json, .updates.json) — shared by every account, as the plugins are. Server only.
 */

export type ApplyResult = { id: string; outcome: "installed" | "reinstalled" | "conflicts" | "same" | "error"; from?: string | null; to?: string; message?: string; conflicts?: string[] };
export type PackagesState = { hash: string; at: string; error?: string; results: ApplyResult[]; unlisted: string[] };
export type UpdateNote = { id: string; name: string; from: string | null; to: string; sourceId: string; source: string; notes: { sha: string; subject: string; at: string; author: string }[]; conflicts: string[] };

const norm = (url: string) => url.trim().toLowerCase().replace(/[\\/]+$/, "");
const stateFile = () => path.join(pluginsRoot(), ".packages-state.json");
const updatesFile = () => path.join(pluginsRoot(), ".updates.json");
const readJson = <T,>(file: string, fallback: T): T => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
};
const writeJson = (file: string, v: unknown) => (fs.mkdirSync(path.dirname(file), { recursive: true }), fs.writeFileSync(file, JSON.stringify(v, null, 1)));

export const packagesState = (): PackagesState | null => readJson<PackagesState | null>(stateFile(), null);

/** Every plugin packages.json lists brought to the place it names. Unchanged file (its hash applied already): nothing, unless `force`. */
export async function applyPackagesFile(opts: { force?: boolean } = {}): Promise<PackagesState | null> {
  const pf = readPackagesFile();
  if (!pf) return null;
  const last = packagesState();
  if (!opts.force && last?.hash === pf.hash) return last;
  if ("error" in pf) {
    const st: PackagesState = { hash: pf.hash, at: new Date().toISOString(), error: pf.error, results: [], unlisted: [] };
    writeJson(stateFile(), st);
    return st;
  }
  const results: ApplyResult[] = [];
  for (const [id, entry] of Object.entries(pf.file.plugins)) {
    const src = pf.file.sources[entry.source];
    try {
      const source = sourceByUrl(src.url);
      if (!source) throw new Error(`No source ${src.url}.`);
      const st = await checkSource(source.id, { fresh: true });
      if (st.error) throw new Error(st.error);
      const remote = st.plugins.find((p) => p.id === id && (!entry.path || p.path === entry.path));
      if (!remote) throw new Error(`${src.url} has no plugin “${id}”${entry.path ? ` in ${entry.path}` : ""}.`);
      const o = origin(id);
      const installed = scanPlugins().plugins.some((p) => p.id === id);
      if (installed && o && norm(o.url) === norm(src.url) && o.path === remote.path) {
        results.push({ id, outcome: "same" });
        continue;
      }
      const r = await installFromSource(source.id, id);
      results.push({ id, outcome: r.conflicts.length ? "conflicts" : installed ? "reinstalled" : "installed", from: r.from, to: r.to, conflicts: r.conflicts });
    } catch (e) {
      results.push({ id, outcome: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }
  const listed = new Set(Object.keys(pf.file.plugins));
  const unlisted = scanPlugins(true)
    .plugins.map((p) => p.id)
    .filter((id) => !listed.has(id) && !!origin(id));
  const st: PackagesState = { hash: pf.hash, at: new Date().toISOString(), results, unlisted };
  writeJson(stateFile(), st);
  return st;
}

/** A plugin installed from a repository written into packages.json (its source added when new) — the file stays what this Zeff has. */
export function rememberInPackages(id: string): void {
  const o = origin(id);
  if (!o) return;
  const pf = readPackagesFile();
  const file: PackagesFile = pf && "file" in pf ? pf.file : { sources: {}, plugins: {} };
  const name = sourceNameFor(file, o.url);
  file.sources[name] ??= { url: o.url };
  file.plugins[id] = { source: name, ...(o.path ? { path: o.path } : {}) };
  const hash = writePackagesFile(file);
  // (written by Zeff itself: not a change to follow)
  const st = packagesState();
  writeJson(stateFile(), { ...(st ?? { results: [], unlisted: [] }), hash, at: new Date().toISOString() });
}

/** The plugin taken out of packages.json (when it is uninstalled). */
export function forgetInPackages(id: string): void {
  const pf = readPackagesFile();
  if (!pf || !("file" in pf) || !pf.file.plugins[id]) return;
  delete pf.file.plugins[id];
  const hash = writePackagesFile(pf.file);
  const st = packagesState();
  writeJson(stateFile(), { ...(st ?? { results: [], unlisted: [] }), hash, at: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// Newer versions: the update notes
// ---------------------------------------------------------------------------

/** Every source checked now: the plugins with a newer version there (from where they came), and those whose update waits for conflicts. */
export async function checkForUpdates(): Promise<UpdateNote[]> {
  const out: UpdateNote[] = [];
  for (const st of await checkAll({ fresh: true })) {
    for (const p of st.plugins) {
      if (!p.updateAvailable || !p.fromHere) continue;
      out.push({ id: p.id, name: p.name, from: p.installed, to: p.version, sourceId: st.source.id, source: st.source.fromPackages ?? st.source.url, notes: await updateNotes(st.source.id, p.id).catch(() => []), conflicts: [] });
    }
  }
  for (const m of pendingMerges()) {
    const open = m.files.filter((f) => f.outcome === "conflict" && !f.resolved).map((f) => f.rel);
    const at = out.find((n) => n.id === m.pluginId);
    if (at) at.conflicts = open;
    else out.push({ id: m.pluginId, name: m.pluginId, from: m.from.version, to: m.to.version, sourceId: "", source: m.to.url, notes: [], conflicts: open });
  }
  writeJson(updatesFile(), { at: new Date().toISOString(), updates: out });
  return out;
}

/** The notes found at the last check, without those put off ("later") for this version in this account. */
export function storedUpdates(): { at: string | null; updates: UpdateNote[] } {
  const r = readJson<{ at: string | null; updates: UpdateNote[] }>(updatesFile(), { at: null, updates: [] });
  const later = getPref<Record<string, string>>("ext.updates.later", {});
  return { at: r.at, updates: r.updates.filter((u) => u.conflicts.length > 0 || later[u.id] !== u.to) };
}

/** “Later”: this version of the plugin isn't offered again (a newer one is). */
export function putOff(id: string, version: string): void {
  setPref("ext.updates.later", { ...getPref<Record<string, string>>("ext.updates.later", {}), [id]: version });
}

// ---------------------------------------------------------------------------
// Running: the watch on packages.json and the half-hourly check (instrumentation.ts)
// ---------------------------------------------------------------------------

const g = globalThis as { __zeffPackagesWatch?: { stop: () => void } };
const CHECK_MS = 30 * 60_000;

export function startPackagesWatch(): void {
  if (g.__zeffPackagesWatch) return;
  const inAccount = <T,>(fn: () => Promise<T>) => withAccount(activeAccountId(), fn);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  const follow = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      if (running) return follow();
      running = true;
      try {
        const before = packagesState()?.at;
        const st = await inAccount(() => applyPackagesFile());
        // (only when it was followed now — an unchanged file keeps its last result, which isn't news)
        if (st && st.at !== before && st.results.some((r) => r.outcome !== "same")) {
          console.log(`[packages] packages.json followed: ${st.results.filter((r) => r.outcome !== "same").map((r) => `${r.id} ${r.outcome}${r.message ? ` (${r.message})` : ""}`).join(", ")}`);
          await inAccount(() => checkForUpdates()).catch(() => {});
        } else if (st?.error) console.warn(`[packages] ${st.error}`);
      } catch (e) {
        console.error("[packages] following packages.json failed", e);
      } finally {
        running = false;
      }
    }, 1200);
  };
  const file = packagesFilePath();
  fs.watchFile(file, { interval: 2500 }, (cur, prev) => {
    if (cur.mtimeMs !== prev.mtimeMs || cur.size !== prev.size) follow();
  });
  follow();
  const check = () => void inAccount(() => checkForUpdates()).catch((e) => console.warn("[packages] checking for updates failed:", e instanceof Error ? e.message : e));
  const first = setTimeout(check, 20_000);
  const every = setInterval(check, CHECK_MS);
  g.__zeffPackagesWatch = {
    stop: () => {
      fs.unwatchFile(file);
      clearTimeout(first);
      clearInterval(every);
      if (timer) clearTimeout(timer);
      g.__zeffPackagesWatch = undefined;
    },
  };
}

export const stopPackagesWatch = () => g.__zeffPackagesWatch?.stop();
