import fs from "node:fs";
import path from "node:path";

/**
 * The code editor's files (Monaco, the editor of VS Code) served from Zeff itself — its loader, its workers, its languages — so the
 * Studio's IDE needs no CDN and works offline. Only files inside monaco-editor/min/vs; cached for a day.
 */

const ROOT = path.join(process.cwd(), "node_modules", "monaco-editor", "min", "vs");
const TYPES: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".ttf": "font/ttf", ".json": "application/json", ".svg": "image/svg+xml" };

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const parts = (await params).path;
  if (parts[0] !== "vs") return new Response("Not found", { status: 404 });
  const file = path.resolve(ROOT, ...parts.slice(1));
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response("Not found", { status: 404 });
  return new Response(fs.readFileSync(file), { headers: { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "public, max-age=86400" } });
}
