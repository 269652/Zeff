/**
 * The files of the widget libraries (sandbox.ts WIDGET_LIBS), as /api/widgets/lib serves them: a published path
 * ("katex/katex.min.css", "katex/fonts/…") → the file in node_modules — only inside each library's own folder, only
 * script, style and font files. Server only.
 */
import path from "node:path";

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
