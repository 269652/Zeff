import fs from "node:fs";
import path from "node:path";
import { getSqlite } from "@/db";
import { emitChange } from "@/lib/events";
import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import { normalizeFiles, normalizeManifest, type Lambda, type LambdaManifest } from "./types";

/**
 * Where lambdas are kept. Zeff's own (a plugin's: the lookups' sources) are folders in the code — `<dir>/<name>/lambda.json` and its
 * files — that a plugin names through the `workspace.lambdas` point; yours are in the database, and so is a built-in you changed (it
 * wins over Zeff's until you reset it). Server only.
 */

/** Plugins bring built-in lambdas: folders (relative to the checkout) holding one lambda each. */
export const builtinLambdasPoint = extensionPoint<{ dir: string }>("workspace.lambdas");

function db() {
  const d = getSqlite();
  d.exec("create table if not exists ws_lambdas (name text primary key, manifest text not null, files text not null, builtin integer not null default 0, updated_at text not null)");
  return d;
}

let cache: { at: number; list: Map<string, Lambda> } | null = null;

function readFolder(folder: string): Lambda | null {
  try {
    const manifest = normalizeManifest(JSON.parse(fs.readFileSync(path.join(folder, "lambda.json"), "utf8")));
    const files: Record<string, string> = {};
    for (const f of fs.readdirSync(folder)) if (f !== "lambda.json" && /\.(mjs|js|json|txt|md)$/.test(f)) files[f] = fs.readFileSync(path.join(folder, f), "utf8");
    // (What a plugin's lambdas share, beside them as _lib.mjs: each gets it as its lib.mjs.)
    const shared = path.join(folder, "..", "_lib.mjs");
    if (!files["lib.mjs"] && fs.existsSync(shared)) files["lib.mjs"] = fs.readFileSync(shared, "utf8");
    return { manifest, files: normalizeFiles(files), builtin: true, changed: false, updatedAt: null };
  } catch (e) {
    console.error(`[lambdas] ${folder}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** Zeff's own lambdas (the installed plugins'), as they come. */
export function builtinLambdas(): Map<string, Lambda> {
  if (cache && Date.now() - cache.at < 5000) return cache.list;
  const list = new Map<string, Lambda>();
  for (const c of builtinLambdasPoint.list()) {
    const dir = path.join(process.cwd(), c.impl.dir);
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, "lambda.json")));
    } catch {
      continue;
    }
    for (const n of names) {
      const l = readFolder(path.join(dir, n));
      if (l) list.set(l.manifest.name, l);
    }
  }
  cache = { at: Date.now(), list };
  return list;
}

type Row = { name: string; manifest: string; files: string; builtin: number; updated_at: string };

const fromRow = (r: Row): Lambda | null => {
  try {
    return { manifest: normalizeManifest({ ...JSON.parse(r.manifest), name: r.name }), files: normalizeFiles(JSON.parse(r.files)), builtin: !!r.builtin, changed: !!r.builtin, updatedAt: r.updated_at };
  } catch {
    return null;
  }
};

/** Every lambda: Zeff's (or your change of one) and yours. */
export function listLambdas(): Lambda[] {
  const out = new Map(builtinLambdas());
  for (const r of db().prepare("select * from ws_lambdas order by name").all() as Row[]) {
    const l = fromRow(r);
    // (A change of a built-in whose plugin is gone stays stored, but isn't there.)
    if (l && (!l.builtin || out.has(l.manifest.name))) out.set(l.manifest.name, l);
  }
  return [...out.values()].sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.manifest.name.localeCompare(b.manifest.name));
}

export const getLambda = (name: string): Lambda | null => listLambdas().find((l) => l.manifest.name === name) ?? null;

/** A lambda saved: a new one of yours, a change of yours, or a change of a built-in (kept beside Zeff's). */
export function saveLambda(raw: { manifest: unknown; files: unknown; previous?: string }): Lambda {
  const manifest: LambdaManifest = normalizeManifest(raw.manifest);
  const files = normalizeFiles(raw.files);
  const builtin = builtinLambdas().has(manifest.name);
  const prev = raw.previous?.trim();
  if (prev && prev !== manifest.name) {
    if (builtinLambdas().has(prev)) throw new Error("A built-in lambda keeps its name — duplicate it to have one of another name.");
    if (getLambda(manifest.name)) throw new Error(`There is a lambda “${manifest.name}” already.`);
    db().prepare("delete from ws_lambdas where name = ?").run(prev);
  }
  db()
    .prepare("insert into ws_lambdas (name, manifest, files, builtin, updated_at) values (?, ?, ?, ?, ?) on conflict(name) do update set manifest = excluded.manifest, files = excluded.files, builtin = excluded.builtin, updated_at = excluded.updated_at")
    .run(manifest.name, JSON.stringify(manifest), JSON.stringify(files), builtin ? 1 : 0, new Date().toISOString());
  emitChange("workspace");
  return getLambda(manifest.name)!;
}

/** A new lambda of yours (the name must be free). */
export function createLambda(raw: { manifest: unknown; files: unknown }): Lambda {
  const m = normalizeManifest(raw.manifest);
  if (getLambda(m.name)) throw new Error(`There is a lambda “${m.name}” already.`);
  return saveLambda(raw);
}

/** Yours deleted; a changed built-in back to Zeff's. */
export function deleteLambda(name: string): void {
  db().prepare("delete from ws_lambdas where name = ?").run(name);
  emitChange("workspace");
}
