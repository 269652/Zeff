/* eslint-disable @typescript-eslint/no-require-imports -- a build loader (and what it uses) is CommonJS: Turbopack loads webpack loaders with require() */
/**
 * The catalog of hooks (docs/mods.md): every hook point of src/ — its name, function or component, async, its parameters, file and line,
 * its code's hash — written to zeff-hooks.json beside the build, so the Mods page and the AI know what can be hooked also where Zeff runs
 * without its sources (the release). Made by next.config.ts when it starts (dev and build) and by `node scripts/mods/catalog.cjs`.
 */
const fs = require("node:fs");
const path = require("node:path");
const { analyze } = require("./analyze.cjs");

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && !e.name.startsWith(".")) walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** The catalog of a checkout (root: the folder with src/). */
function buildCatalog(root) {
  const src = path.join(root, "src");
  const points = [];
  for (const f of walk(src, [])) {
    const rel = path.relative(src, f).split(path.sep).join("/");
    try {
      const a = analyze(rel, fs.readFileSync(f, "utf8"));
      for (const p of a.points) points.push({ id: p.id, kind: p.kind, async: p.async, params: p.params, file: `src/${rel}`, line: p.line, hash: p.hash, side: a.client ? "client" : "server" });
    } catch {
      /* (a file the parser can't read has no hooks) */
    }
  }
  points.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { made: new Date().toISOString(), count: points.length, points };
}

/** Written beside the build (zeff-hooks.json in the app's folder) — only when src/ is there. */
function writeCatalog(root) {
  if (!fs.existsSync(path.join(root, "src"))) return null;
  const c = buildCatalog(root);
  fs.writeFileSync(path.join(root, "zeff-hooks.json"), JSON.stringify(c));
  return c.count;
}

module.exports = { buildCatalog, writeCatalog };

if (require.main === module) console.log(`zeff-hooks.json: ${writeCatalog(process.cwd())} hooks`);
