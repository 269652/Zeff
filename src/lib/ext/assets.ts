import fs from "node:fs";
import path from "node:path";

/**
 * The files a plugin's panels may load: its ui/ folder, and nothing else of the plugin (hook
 * scripts, rule files, storage stay out of reach). A request's path can't leave ui/: no "..", no
 * dotfiles, and a symbolic link out of the folder doesn't count.
 */

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

export type Asset = { file: string; size: number; mtimeMs: number; type: string };

/** The file for a path inside a plugin's ui/ folder, or null (missing, not allowed, not a type panels need). */
export function resolveAsset(pluginDir: string, segments: string[]): Asset | null {
  if (!segments.length || segments.some((s) => !s || s === "." || s === ".." || s.startsWith(".") || /[\\/\0:]/.test(s))) return null;
  const type = TYPES[path.extname(segments[segments.length - 1]).toLowerCase()];
  if (!type) return null;
  try {
    const root = fs.realpathSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ pluginDir, "ui"));
    const real = fs.realpathSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ root, ...segments));
    if (!real.startsWith(root + path.sep)) return null;
    const st = fs.statSync(/*turbopackIgnore: true*/ real);
    return st.isFile() ? { file: real, size: st.size, mtimeMs: st.mtimeMs, type } : null;
  } catch {
    return null;
  }
}

/** The Content-Security-Policy every plugin file is served with: it runs in an opaque origin whatever way it is opened. */
export function assetCsp(network: boolean): string {
  return [
    "sandbox allow-scripts allow-forms allow-popups allow-modals",
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    network ? "connect-src * data: blob:" : "connect-src 'self'",
    "frame-ancestors 'self'",
  ].join("; ");
}
