/**
 * The files of the widget libraries (sandbox.ts WIDGET_LIBS), as /api/widgets/lib serves them: a published path
 * ("katex/katex.min.css", "katex/fonts/…") → the file in node_modules — only inside each library's own folder, only
 * script, style and font files. Server only.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { WIDGET_LIBS } from "./sandbox";

/** Each library's folder in node_modules. */
const ROOTS: Record<string, string> = {
  katex: "katex/dist",
  jsxgraph: "jsxgraph/distrib",
  three: "three/build",
  chart: "chart.js/dist",
  mathjs: "mathjs/lib/browser",
  algebrite: "algebrite/dist",
  plotly: "plotly.js-dist-min",
  d3: "d3/dist",
  "3dmol": "3dmol/build",
  smiles: "smiles-drawer/dist",
  network: "cytoscape/dist",
  astronomy: "astronomy-engine",
  stats: "simple-statistics/dist",
  // Put together by scripts/widget-libs.mjs (three.js with its add-ons, the physics engines, the world map) — made when first asked.
  built: ".cache/zeff-widget-libs",
};

let builtOnce = false;
/** The composed libraries made (once per server, and only when missing or out of date — the script checks). */
function ensureBuilt(): void {
  if (builtOnce) return;
  builtOnce = true;
  const script = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "scripts", "widget-libs.mjs");
  if (fs.existsSync(script)) spawnSync(process.execPath, [script], { cwd: process.cwd(), stdio: "ignore", timeout: 120_000, windowsHide: true });
}

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

export const contentTypeOf = (file: string): string | null => TYPES[path.extname(file).toLowerCase()] ?? null;

/** The file for a published path, or null (unknown library, outside its folder, not a served kind of file). */
export function libFile(published: string): string | null {
  if (typeof published !== "string" || /%|\\|\0/.test(published)) return null;
  const [lib, ...rest] = published.split("/");
  const root = ROOTS[lib];
  if (!root || !rest.length || rest.some((p) => !p || p === "." || p === "..")) return null;
  const base = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "node_modules", root);
  const file = path.resolve(base, ...rest);
  if (!file.startsWith(base + path.sep)) return null;
  if (lib === "built") ensureBuilt();
  return contentTypeOf(file) ? file : null;
}

const bundles = new Map<string, { js: string[]; css: string[] }>();

/**
 * The libraries' code and CSS as text, to put into a widget's page (the frame loads nothing): KaTeX's fonts inlined
 * as data: (woff2 only — every browser that runs Zeff has it). Kept in memory once made.
 */
export function libBundle(names: string[]): { js: string[]; css: string[] } {
  const libs = [...new Set(names)].filter((l) => Object.prototype.hasOwnProperty.call(WIDGET_LIBS, l)).sort();
  const key = libs.join(",");
  const had = bundles.get(key);
  if (had) return had;
  const read = (f: string) => {
    const file = libFile(f);
    return file && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  };
  const js = libs.flatMap((l) => WIDGET_LIBS[l].js ?? []).map(read).filter(Boolean);
  const css = libs.flatMap((l) => (WIDGET_LIBS[l].css ?? []).map((f) => [l, f] as const)).map(([lib, f]) =>
    read(f)
      .replace(/,\s*url\((["']?)fonts\/[^)]+\.(?:woff|ttf)\1\)\s*format\(["'][^"']+["']\)/g, "")
      .replace(/url\((["']?)(fonts\/[^)]+\.woff2)\1\)/g, (_m, _q, font: string) => {
        const file = libFile(`${lib}/${font}`);
        return file && fs.existsSync(file) ? `url(data:font/woff2;base64,${fs.readFileSync(file).toString("base64")})` : "url()";
      }),
  );
  // The exercise kit (kit/kit.js) in every widget, after the libraries (it uses KaTeX when it's there).
  const out = { js: [...js, kitSource()].filter(Boolean), css: css.filter(Boolean) };
  bundles.set(key, out);
  return out;
}

let kit: string | null = null;
/** Zeff's exercise kit (src/lib/widgets/kit/kit.js — ZeffKit.mount, the checkers), as text. */
export function kitSource(): string {
  if (kit === null) {
    const file = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "src", "lib", "widgets", "kit", "kit.js");
    // (And the science kit after it — kit/science.js: numbers, colour maps, 3D scenes, iso-surfaces, answers as pods.)
    const science = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "src", "lib", "widgets", "kit", "science.js");
    kit = [file, science].filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f, "utf8")).join("\n;\n");
  }
  return kit;
}
