import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BASE_DIR } from "@/db/accounts";

/**
 * packages.json — which plugins this Zeff has, and where each comes from (like a package.json of npm): its repositories by a name, and
 * per plugin the repository and the folder in it (the branch is the source's). It lies beside the plugins (<data>/packages.json; or
 * ZEFF_PACKAGES_FILE). Zeff writes it when a plugin is installed from a repository, and reads it again when it changed — a plugin listed
 * there that isn't installed from that place is installed (reinstalled from the new place, merged with what was changed here). Server only.
 *
 * {
 *   "sources": { "zeff-plugins": { "url": "../zeff-plugins", "branch": "main" } },
 *   "plugins": { "learn-ext": { "source": "zeff-plugins", "path": "plugins/learn" } }
 * }
 */

export type PackagesFile = {
  $schema?: string;
  sources: Record<string, { url: string; branch?: string }>;
  plugins: Record<string, { source: string; path?: string }>;
};

export const packagesFilePath = (): string => (process.env.ZEFF_PACKAGES_FILE ? path.resolve(/*turbopackIgnore: true*/ process.env.ZEFF_PACKAGES_FILE) : path.join(/*turbopackIgnore: true*/ BASE_DIR, "packages.json"));

const NAME = /^[\w.-]{1,60}$/;

/** The file checked: what doesn't hold is said (a plugin naming a source that isn't there, a name with odd characters). */
export function parsePackagesFile(raw: string): { ok: true; file: PackagesFile } | { ok: false; error: string } {
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `packages.json is no JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  const obj = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
  const sources: PackagesFile["sources"] = {};
  for (const [name, v] of Object.entries((obj.sources ?? {}) as Record<string, unknown>)) {
    const s = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    if (!NAME.test(name)) return { ok: false, error: `“${name}” is no name for a source.` };
    if (typeof s.url !== "string" || !s.url.trim()) return { ok: false, error: `The source “${name}” has no url.` };
    sources[name] = { url: s.url.trim(), ...(typeof s.branch === "string" && s.branch ? { branch: s.branch } : {}) };
  }
  const plugins: PackagesFile["plugins"] = {};
  for (const [id, v] of Object.entries((obj.plugins ?? {}) as Record<string, unknown>)) {
    const p = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    if (!NAME.test(id)) return { ok: false, error: `“${id}” is no plugin id.` };
    if (typeof p.source !== "string" || !sources[p.source]) return { ok: false, error: `The plugin “${id}” names no source of the file (“${String(p.source ?? "")}”).` };
    const dir = typeof p.path === "string" ? p.path.replace(/^\/+|\/+$/g, "") : "";
    if (dir.split("/").some((x) => x === ".." || x.startsWith("."))) return { ok: false, error: `The plugin “${id}” has a path outside its repository.` };
    plugins[id] = { source: p.source, ...(dir ? { path: dir } : {}) };
  }
  return { ok: true, file: { ...(typeof obj.$schema === "string" ? { $schema: obj.$schema } : {}), sources, plugins } };
}

/** The file as it is now (none: null), with a hash of its text — what tells it changed. */
export function readPackagesFile(): { file: PackagesFile; hash: string } | { error: string; hash: string } | null {
  let raw: string;
  try {
    raw = fs.readFileSync(packagesFilePath(), "utf8");
  } catch {
    return null;
  }
  const hash = crypto.createHash("sha1").update(raw).digest("hex");
  const r = parsePackagesFile(raw);
  return r.ok ? { file: r.file, hash } : { error: r.error, hash };
}

export function writePackagesFile(file: PackagesFile): string {
  const sortObj = <T,>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  const text = `${JSON.stringify({ ...(file.$schema ? { $schema: file.$schema } : {}), sources: sortObj(file.sources), plugins: sortObj(file.plugins) }, null, 2)}\n`;
  fs.mkdirSync(path.dirname(packagesFilePath()), { recursive: true });
  fs.writeFileSync(packagesFilePath(), text);
  return crypto.createHash("sha1").update(text).digest("hex");
}

/** The file's name for a repository (made from its address, unique in the file). */
export function sourceNameFor(file: PackagesFile, url: string): string {
  const hit = Object.entries(file.sources).find(([, s]) => s.url.toLowerCase() === url.toLowerCase());
  if (hit) return hit[0];
  const base = (url.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "source").replace(/\.git$/, "").replace(/[^\w.-]/g, "-") || "source";
  let name = base;
  for (let i = 2; file.sources[name]; i++) name = `${base}-${i}`;
  return name;
}
