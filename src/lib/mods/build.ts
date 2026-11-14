import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import { getMod, hookCatalog, setModState, type Mod } from "./store";

/**
 * A mod built (docs/mods.md): its server and browser parts each bundled by esbuild (shipped with Zeff — no build of Zeff needed) into one
 * script that hands its setup to Zeff (globalThis.__zeffModsQueue). React is Zeff's own — handed in as `__host.React`, never a copy: a mod's
 * components draw with the React they are drawn in. JSX works in .tsx/.jsx. A server part may require Node's modules (__host.require).
 * Server only.
 */

const REACT_SHIM = "module.exports = __host.React;";

async function bundle(mod: Mod, file: string, part: "server" | "client"): Promise<string> {
  const esbuild = (await import(/* turbopackIgnore: true */ "esbuild")) as typeof import("esbuild");
  const r = await esbuild.build({
    entryPoints: [path.join(mod.dir, file)],
    absWorkingDir: mod.dir,
    bundle: true,
    write: false,
    format: "iife",
    globalName: "__zeffModMain",
    platform: part === "server" ? "node" : "browser",
    target: part === "server" ? "node20" : "es2020",
    jsx: "transform",
    jsxFactory: "__host.React.createElement",
    jsxFragment: "__host.React.Fragment",
    logLevel: "silent",
    plugins: [
      {
        name: "zeff-host",
        setup(b) {
          // React (and its JSX runtime) is the host's; "@zeff/mod" is only its types.
          b.onResolve({ filter: /^(react|react\/jsx-runtime|react\/jsx-dev-runtime|@zeff\/mod)$/ }, (a) => ({ path: a.path, namespace: "zeff-host" }));
          b.onLoad({ filter: /.*/, namespace: "zeff-host" }, (a) => ({ contents: a.path === "@zeff/mod" ? "module.exports = {};" : a.path === "react" ? REACT_SHIM : "var R = __host.React; module.exports = { jsx: function (t, p, k) { return R.createElement(t, k === undefined ? p : Object.assign({}, p, { key: k })); }, jsxs: function (t, p, k) { return R.createElement(t, k === undefined ? p : Object.assign({}, p, { key: k })); }, Fragment: R.Fragment };", loader: "js" }));
          // Nothing from outside its folder (but Node's own modules, on the server).
          b.onResolve({ filter: /^[^./]/ }, (a) => {
            // (the entry point, an absolute path — C:\… on Windows — is its own file)
            if (a.kind === "entry-point" || path.isAbsolute(a.path)) return undefined;
            return part === "server" && (a.path.startsWith("node:") || builtinModules.includes(a.path.split("/")[0])) ? { path: a.path, external: true } : { errors: [{ text: `“${a.path}”: a mod brings its own code; Zeff hands it React (and the server part Node's modules).` }] };
          });
        },
      },
    ],
  });
  return r.outputFiles[0].text;
}

/** The script that hands one part to Zeff: its setup(host) returns the mod's function that registers its hooks. */
const wrap = (mod: Mod, part: "server" | "client", code: string) =>
  `(globalThis.__zeffModsQueue = globalThis.__zeffModsQueue || []).push({ mod: ${JSON.stringify(mod.manifest.id)}, part: ${JSON.stringify(part)}, targets: ${JSON.stringify(mod.manifest.targets ?? {})}, setup: function (__host) {\n` +
  `var require = (__host && __host.require) || globalThis.__zeffRequire;\n${code}\n` +
  `var m = typeof __zeffModMain === "undefined" ? undefined : __zeffModMain; var f = m && (m.default || m.setup || m); return typeof f === "function" ? f : function () {};\n} });\n`;

/** The hooks its code names (in quotes), with their code's hash now: written into its manifest's targets on save (catalog: zeff-hooks.json). */
export function targetsOf(sources: string[]): Record<string, string> {
  const catalog = new Map(hookCatalog().map((p) => [p.id, p.hash]));
  const out: Record<string, string> = {};
  for (const s of sources) for (const m of s.matchAll(/["'`]([\w./[\]()-]+#[\w$]+)["'`]/g)) if (catalog.has(m[1])) out[m[1]] = catalog.get(m[1])!;
  return out;
}

/** Built: .build/server.js, .build/client.js, .build/style.css — or what is wrong (said, and the mod stays off). */
export async function buildMod(id: string): Promise<{ ok: boolean; problems: string[] }> {
  const mod = getMod(id);
  if (!mod) throw new Error(`There is no mod “${id}”.`);
  const out = path.join(mod.dir, ".build");
  fs.mkdirSync(/*turbopackIgnore: true*/ out, { recursive: true });
  const problems: string[] = [];
  const done: { server?: boolean; client?: boolean; css?: boolean } = {};
  for (const part of ["server", "client"] as const) {
    const file = mod.manifest[part];
    const target = path.join(out, `${part}.js`);
    if (!file) {
      fs.rmSync(target, { force: true });
      continue;
    }
    try {
      fs.writeFileSync(/*turbopackIgnore: true*/ target, wrap(mod, part, await bundle(mod, file, part)));
      done[part] = true;
    } catch (e) {
      fs.rmSync(target, { force: true });
      const errs = (e as { errors?: { text: string; location?: { file: string; line: number } | null }[] }).errors;
      problems.push(...(errs?.length ? errs.map((x) => `${part}: ${x.location ? `${path.basename(x.location.file)}:${x.location.line}: ` : ""}${x.text}`) : [`${part}: ${e instanceof Error ? e.message : String(e)}`]));
    }
  }
  const cssTarget = path.join(out, "style.css");
  if (mod.manifest.css && fs.existsSync(path.join(mod.dir, mod.manifest.css))) {
    fs.copyFileSync(path.join(mod.dir, mod.manifest.css), cssTarget);
    done.css = true;
  } else fs.rmSync(cssTarget, { force: true });
  setModState(id, { built: { at: new Date().toISOString(), ...done, ...(problems.length ? { problems } : {}) }, ...(problems.length ? { enabled: false, disabledReason: "it doesn't build — see its problems" } : {}) });
  return { ok: !problems.length, problems };
}
