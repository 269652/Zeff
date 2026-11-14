import fs from "node:fs";
import path from "node:path";
import { BASE_DIR } from "@/db/accounts";
import { setSafeMode as setKernelSafeMode } from "@/lib/kernel/safe-mode";
import { rememberUndo } from "@/plugins/workspace/undo";

/**
 * Mods on this computer (docs/mods.md): each a folder in data/mods/ — its zeff-mod.json, its code (a server part, a browser part, a
 * stylesheet), what it was built to (.build/), its state (.state.json: on or off, why it was switched off, its errors) and its earlier
 * versions (.versions/). Mods change Zeff itself — they run with Zeff's rights — so one is on only when you switched it on, and a change
 * made by the AI switches it off until you look at it again. Server only.
 */

export const modsRoot = (): string => (process.env.ZEFF_MODS_DIR ? path.resolve(/*turbopackIgnore: true*/ process.env.ZEFF_MODS_DIR) : path.join(/*turbopackIgnore: true*/ BASE_DIR, "mods"));

export type ModManifest = {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  /** Its files (in its folder): what runs on the server, in the browser, and a stylesheet. */
  server?: string;
  client?: string;
  css?: string;
  /** The hooks it was written for, with their code's hash then: a hook whose code changed since is held back (filled in on save). */
  targets?: Record<string, string>;
};
export type ModState = { enabled: boolean; /** The accounts it is for — a change asked for in one account stays there (unset: every account). */ accounts?: string[]; changedAt?: string; by?: "you" | "ai"; disabledReason?: string; errors?: { hook: string; message: string; at: string; where: string }[]; built?: { at: string; server?: boolean; client?: boolean; css?: boolean; problems?: string[] } };
export type Mod = { manifest: ModManifest; dir: string; state: ModState };

export const MOD_ID = /^[a-z][a-z0-9-]{1,39}$/;
const MAX_SOURCE = 400_000;

const readJson = <T>(file: string, fallback: T): T => {
  try {
    return JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8")) as T;
  } catch {
    return fallback;
  }
};

export function normalizeManifest(raw: unknown): ModManifest {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const id = String(o.id ?? "").trim();
  if (!MOD_ID.test(id)) throw new Error("A mod's id: lowercase letters, digits and -, 2 to 40 (\"sidebar-clock\").");
  const file = (k: string) => {
    const v = o[k];
    if (v === undefined || v === null || v === "") return undefined;
    const s = String(v);
    if (!/^[\w.-]+\.(ts|tsx|js|jsx|mjs|css)$/.test(s)) throw new Error(`${k}: a file of the mod's folder ("server.ts").`);
    return s;
  };
  const targets = o.targets && typeof o.targets === "object" ? Object.fromEntries(Object.entries(o.targets as Record<string, unknown>).filter(([k, v]) => /^[\w./[\]()-]+#[\w$]+$/.test(k) && typeof v === "string").slice(0, 300)) as Record<string, string> : undefined;
  return {
    id,
    name: String(o.name ?? id).slice(0, 80),
    version: String(o.version ?? "0.1.0").slice(0, 30),
    description: String(o.description ?? "").slice(0, 500),
    ...(o.author ? { author: String(o.author).slice(0, 100) } : {}),
    ...(file("server") ? { server: file("server") } : {}),
    ...(file("client") ? { client: file("client") } : {}),
    ...(file("css") ? { css: file("css") } : {}),
    ...(targets && Object.keys(targets).length ? { targets } : {}),
  };
}

export const modDir = (id: string) => path.join(modsRoot(), id);
const stateFile = (id: string) => path.join(modDir(id), ".state.json");
export const modState = (id: string): ModState => readJson<ModState>(stateFile(id), { enabled: false });
export function setModState(id: string, patch: Partial<ModState>): ModState {
  const next = { ...modState(id), ...patch };
  fs.writeFileSync(/*turbopackIgnore: true*/ stateFile(id), JSON.stringify(next, null, 2));
  return next;
}

/** Every mod (a folder with a zeff-mod.json that holds). */
export function listMods(): Mod[] {
  const root = modsRoot();
  let names: string[] = [];
  try {
    names = fs.readdirSync(/*turbopackIgnore: true*/ root, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
  } catch {
    return [];
  }
  return names.sort().flatMap((name) => {
    try {
      const manifest = normalizeManifest(readJson(path.join(root, name, "zeff-mod.json"), null));
      if (manifest.id !== name) return [];
      return [{ manifest, dir: path.join(root, name), state: modState(name) }];
    } catch {
      return [];
    }
  });
}
export const getMod = (id: string): Mod | null => listMods().find((m) => m.manifest.id === id) ?? null;

/** A mod's source files, by name (what the Mods page shows and the AI reads). */
export function modSources(id: string): Record<string, string> {
  const m = getMod(id);
  if (!m) throw new Error(`There is no mod “${id}”.`);
  const out: Record<string, string> = { "zeff-mod.json": JSON.stringify(m.manifest, null, 2) };
  for (const f of [m.manifest.server, m.manifest.client, m.manifest.css]) if (f) out[f] = fs.existsSync(path.join(m.dir, f)) ? fs.readFileSync(/*turbopackIgnore: true*/ path.join(m.dir, f), "utf8") : "";
  return out;
}

// ---------------------------------------------------------------------------
// Safe mode: Zeff without any mod (a file, or ZEFF_SAFE_MODE=1)
// ---------------------------------------------------------------------------

// It is Zeff's one safe mode (lib/kernel/safe-mode.ts): with the mods, the external plugins and what runs by itself are off too.
export { safeMode } from "@/lib/kernel/safe-mode";
export function setSafeMode(on: boolean): void {
  setKernelSafeMode(on, { by: "you" });
}

// ---------------------------------------------------------------------------
// Saving: the files written, the one before kept as a version
// ---------------------------------------------------------------------------

const VERSIONS_KEPT = 30;

/** A mod written (made, or changed): its manifest and files; the version before kept. A change by the AI switches it off. */
export function writeMod(manifestRaw: unknown, files: Record<string, string>, by: "you" | "ai"): Mod {
  const manifest = normalizeManifest(manifestRaw);
  const dir = modDir(manifest.id);
  const exists = fs.existsSync(path.join(dir, "zeff-mod.json"));
  for (const [name, text] of Object.entries(files)) {
    if (![manifest.server, manifest.client, manifest.css].includes(name)) throw new Error(`“${name}” is no file the manifest names (server, client, css).`);
    if (text.length > MAX_SOURCE) throw new Error(`${name} is too long.`);
  }
  let kept: string | null = null;
  if (exists) {
    // The version before: its files, as they were.
    kept = String(Date.now());
    const v = path.join(dir, ".versions", kept);
    fs.mkdirSync(/*turbopackIgnore: true*/ v, { recursive: true });
    for (const e of fs.readdirSync(/*turbopackIgnore: true*/ dir, { withFileTypes: true })) if (e.isFile() && !e.name.startsWith(".")) fs.copyFileSync(path.join(dir, e.name), path.join(v, e.name));
    const all = fs.readdirSync(/*turbopackIgnore: true*/ path.join(dir, ".versions")).sort();
    for (const old of all.slice(0, Math.max(0, all.length - VERSIONS_KEPT))) fs.rmSync(path.join(dir, ".versions", old), { recursive: true, force: true });
  }
  fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(/*turbopackIgnore: true*/ path.join(dir, name), text);
  fs.writeFileSync(/*turbopackIgnore: true*/ path.join(dir, "zeff-mod.json"), JSON.stringify(manifest, null, 2));
  const before = modState(manifest.id);
  // (Inside an AI answer: Undo brings this version back - or moves a new mod aside.)
  rememberUndo(`mod:${manifest.id}`, { kind: "mod", id: manifest.id, version: kept, enabled: before.enabled });
  // (The AI's change: off until you look at it. Yours: as it was.)
  setModState(manifest.id, { enabled: by === "ai" ? false : before.enabled, changedAt: new Date().toISOString(), by, ...(by === "ai" && before.enabled ? { disabledReason: "changed by the AI — look at it and switch it on again" } : {}) });
  return getMod(manifest.id)!;
}

export function modVersions(id: string): { id: string; at: string; files: string[] }[] {
  const dir = path.join(modDir(id), ".versions");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(/*turbopackIgnore: true*/ dir)
    .sort()
    .reverse()
    .map((v) => ({ id: v, at: new Date(Number(v)).toISOString(), files: fs.readdirSync(/*turbopackIgnore: true*/ path.join(dir, v)) }));
}

/** A version's files back (what it is now kept as a version in turn); the mod is switched off until you switch it on. */
export function restoreModVersion(id: string, version: string): Mod {
  if (!/^\d+$/.test(version)) throw new Error("No such version.");
  const src = path.join(modDir(id), ".versions", version);
  if (!fs.existsSync(src)) throw new Error("No such version.");
  const files: Record<string, string> = {};
  let manifest: unknown = null;
  for (const f of fs.readdirSync(/*turbopackIgnore: true*/ src)) {
    const text = fs.readFileSync(/*turbopackIgnore: true*/ path.join(src, f), "utf8");
    if (f === "zeff-mod.json") manifest = JSON.parse(text);
    else files[f] = text;
  }
  const m = writeMod(manifest, Object.fromEntries(Object.entries(files).filter(([f]) => { const n = normalizeManifest(manifest); return [n.server, n.client, n.css].includes(f); })), "you");
  setModState(id, { enabled: false });
  return m;
}

export function removeMod(id: string): void {
  if (!MOD_ID.test(id)) throw new Error("No such mod.");
  const dir = modDir(id);
  if (!fs.existsSync(dir)) return;
  // (Moved aside, not deleted: data/mods/.removed/<id>-<time>.)
  const to = path.join(modsRoot(), ".removed", `${id}-${Date.now()}`);
  fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(to), { recursive: true });
  fs.renameSync(dir, to);
}

/** The hooks a mod names whose code changed since it was written for them, or that are gone (the catalog: hook → hash). */
export const staleTargets = (m: ModManifest, catalog: Map<string, string>): string[] =>
  Object.entries(m.targets ?? {})
    .filter(([hook, hash]) => catalog.get(hook) !== hash)
    .map(([hook]) => hook);

/** The catalog of hooks beside the build (zeff-hooks.json) — what can be hooked, here. */
export type HookPoint = { id: string; kind: "function" | "component"; async: boolean; params: string; file: string; line: number; hash: string; side: "client" | "server" };
let catalogCache: { at: number; points: HookPoint[] } | null = null;
export function hookCatalog(): HookPoint[] {
  if (catalogCache && Date.now() - catalogCache.at < 60_000) return catalogCache.points;
  const points = readJson<{ points?: HookPoint[] }>(path.join(/*turbopackIgnore: true*/ process.cwd(), "zeff-hooks.json"), {}).points ?? [];
  catalogCache = { at: Date.now(), points };
  return points;
}
