/**
 * The files of the widget libraries (sandbox.ts WIDGET_LIBS), as /api/widgets/lib serves them: a published path
 * ("katex/katex.min.css", "katex/fonts/…") → the file in node_modules — only inside each library's own folder, only
 * script, style and font files. Server only.
 */
import fs from "node:fs";
import path from "node:path";
import { WIDGET_LIBS } from "./sandbox";

/** Each library's folder in node_modules. */
const ROOTS: Record<string, string> = {
  katex: "katex/dist",
  jsxgraph: "jsxgraph/distrib",
  three: "three/build",
  chart: "chart.js/dist",
};

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
  const out = { js, css: css.filter(Boolean) };
  bundles.set(key, out);
  return out;
}
