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
// Its styles: Zeff's own (src/app/globals.css — Tailwind, its tokens, .card / .btn / .input, dark mode), the classes the
// offline app uses, and its Geist font — so the app looks like Zeff, not like an app of its own; then the few of its own.
const { default: postcss } = await import("postcss");
const { default: tailwind } = await import("@tailwindcss/postcss");
const globalsFile = path.join(ROOT, "src", "app", "globals.css");
const globals = fs
  .readFileSync(globalsFile, "utf8")
  .replace('@import "tailwindcss" source("../");', `@import "tailwindcss" source(none);\n@source "${path.join(ROOT, "companion", "offline").split(path.sep).join("/")}";`)
  .replace('@source "../../integrations";', "");
const font = `@font-face { font-family: "Geist"; src: url("/_zc/Geist-latin.woff2") format("woff2"); font-weight: 100 900; font-display: swap; }
:root { --font-geist-sans: "Geist", system-ui, Arial; --font-geist-mono: ui-monospace, Consolas; }
`;
const css = await postcss([tailwind({ base: ROOT })]).process(globals, { from: globalsFile });
fs.writeFileSync(path.join(OUT, "offline.css"), font + css.css + "\n" + fs.readFileSync(path.join(ROOT, "companion", "offline", "offline.css"), "utf8"));
fs.copyFileSync(path.join(ROOT, "src", "app", "fonts", "Geist-latin.woff2"), path.join(OUT, "Geist-latin.woff2"));
const bytes = Object.values(r.metafile.outputs).reduce((s, o) => s + o.bytes, 0);
console.log(`companion/app/_zc/offline.js — ${Math.round(bytes / 1024)} KB`);
