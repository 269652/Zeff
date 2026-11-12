import fs from "node:fs";
import path from "node:path";
import { listFunctions, type FnInfo } from "./functions";

/**
 * A plugin function's code, changed at runtime — by you or the AI, like a flow: the code before kept as a version beside it (the plugin's
 * folder, .versions/<file>/<time>), the newest 30. Before it is saved a Node.js function must at least parse. Server only.
 */

const KEPT = 30;

function find(plugin: string, name: string): FnInfo & { abs: string } {
  const f = listFunctions().find((x) => x.plugin === plugin && x.name === name);
  if (!f) throw new Error(`There is no function “${plugin}.${name}” (the plugin must be on and bring it).`);
  const abs = path.resolve(f.dir, f.file);
  if (!abs.startsWith(path.resolve(f.dir) + path.sep)) throw new Error("The function's file is outside its plugin's folder.");
  return { ...f, abs };
}

const versionsDir = (f: { dir: string; file: string }) => path.join(f.dir, ".versions", f.file.replace(/[\\/]/g, "_"));

/** Its code and its versions (newest first). */
export function functionSource(plugin: string, name: string): { code: string; file: string; runtime: string; versions: { id: string; at: string; size: number }[] } {
  const f = find(plugin, name);
  return { code: fs.readFileSync(f.abs, "utf8"), file: f.file, runtime: f.runtime, versions: functionVersions(f) };
}

function functionVersions(f: { dir: string; file: string }): { id: string; at: string; size: number }[] {
  const dir = versionsDir(f);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .sort()
    .reverse()
    .map((id) => ({ id, at: new Date(Number(id.split(".")[0])).toISOString(), size: fs.statSync(path.join(dir, id)).size }));
}

/** A Node.js function's code that doesn't parse: why (null: it does). The code runs as the body of an async function with `zeff` and `inputs`. */
export function syntaxProblem(code: string): string | null {
  try {
    const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (...args: string[]) => unknown;
    new AsyncFunction("zeff", "inputs", code);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** New code for a function (the code it had kept as a version). */
export function saveFunctionSource(plugin: string, name: string, code: string): { versions: number } {
  const f = find(plugin, name);
  if (code.length > 200_000) throw new Error("That code is too long.");
  if (f.runtime === "node") {
    const why = syntaxProblem(code);
    if (why) throw new Error(`Not saved — the code doesn't parse: ${why}`);
  }
  const before = fs.readFileSync(f.abs, "utf8");
  if (before === code) return { versions: functionVersions(f).length };
  const dir = versionsDir(f);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${Date.now()}${path.extname(f.file)}`), before);
  for (const old of fs.readdirSync(dir).sort().reverse().slice(KEPT)) fs.rmSync(path.join(dir, old), { force: true });
  fs.writeFileSync(f.abs, code);
  return { versions: functionVersions(f).length };
}

/** A version's code. */
export function functionVersionCode(plugin: string, name: string, version: string): string {
  const f = find(plugin, name);
  if (!/^\d+\.[a-z]+$/.test(version)) throw new Error("No such version.");
  const file = path.join(versionsDir(f), version);
  if (!fs.existsSync(file)) throw new Error("No such version.");
  return fs.readFileSync(file, "utf8");
}

/** A version's code back (the code it has now kept as a version in turn). */
export function restoreFunctionSource(plugin: string, name: string, version: string): void {
  saveFunctionSource(plugin, name, functionVersionCode(plugin, name, version));
}
