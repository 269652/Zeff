import fs from "node:fs";
import path from "node:path";
import { getPlugin } from "@/lib/ext/registry";
import { foreignRequest, refused } from "@/lib/request-guard";

export const dynamic = "force-dynamic";

/**
 * GET /api/ext/compute/<plugin> — a plugin's compute script (manifest contributes.compute): pure functions a view runs in the browser,
 * in a sandboxed frame of their own (<data compute="…">, workspace/ui/compute-data.tsx) — no network, no access to Zeff, only what the
 * view hands them. Only while the plugin is on (safe mode: never); only to Zeff's own pages.
 */
export async function GET(req: Request, { params }: { params: Promise<{ plugin: string }> }) {
  const why = foreignRequest(req);
  if (why) return refused(why);
  const { plugin } = await params;
  const p = getPlugin(String(plugin));
  const rel = p?.enabled ? p.manifest.contributes.compute : undefined;
  const js = (status: number, body: string) => new Response(body, { status, headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" } });
  if (!p || !rel) return js(404, "// no compute script");
  const file = path.resolve(p.dir, rel);
  if (!file.startsWith(path.resolve(p.dir) + path.sep) || !fs.existsSync(file)) return js(404, "// missing");
  return js(200, fs.readFileSync(file, "utf8"));
}
