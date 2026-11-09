#!/usr/bin/env node
/**
 * The phone app's offline part (companion/offline: Todos, Workspace, Calendar from the phone's own copy) bundled for
 * app.getzeff.com: companion/app/_zc/offline.js (React, the replica engine and the Zeff modules it reuses — pure ones
 * only), plus its styles as offline.css. Run by `npm run companion:build` and before every companion deploy; the
 * output isn't kept in git (.gitignore).
 */
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "companion", "app", "_zc");

const r = await build({
  entryPoints: [path.join(ROOT, "companion", "offline", "main.tsx")],
  outfile: path.join(OUT, "offline.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022", "safari16"],
  jsx: "automatic",
  minify: true,
  sourcemap: false,
  tsconfig: path.join(ROOT, "tsconfig.json"),
  define: { "process.env.NODE_ENV": '"production"' },
  metafile: true,
  logLevel: "warning",
});
fs.copyFileSync(path.join(ROOT, "companion", "offline", "offline.css"), path.join(OUT, "offline.css"));
const bytes = Object.values(r.metafile.outputs).reduce((s, o) => s + o.bytes, 0);
console.log(`companion/app/_zc/offline.js — ${Math.round(bytes / 1024)} KB`);
