import fs from "node:fs";
import { assetCsp, resolveAsset } from "@/lib/ext/assets";
import { getPlugin } from "@/lib/ext/registry";

export const dynamic = "force-dynamic";

/**
 * GET /ext/<plugin>/<file> — a file of an enabled plugin's ui/ folder (docs/plugins/panels.md).
 * Always with a Content-Security-Policy that sandboxes it (no origin of its own, even opened
 * directly in a tab), so a panel can't act as Zeff's page.
 */
export async function GET(req: Request, { params }: { params: Promise<{ plugin: string; path: string[] }> }) {
  const { plugin: id, path: segments } = await params;
  const plugin = getPlugin(id);
  if (!plugin || !plugin.enabled) return new Response("Not found", { status: 404 });
  let names: string[];
  try {
    names = segments.map(decodeURIComponent);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const asset = resolveAsset(plugin.dir, names);
  if (!asset) return new Response("Not found", { status: 404 });
  const etag = `W/"${asset.size}-${Math.round(asset.mtimeMs)}"`;
  const headers: Record<string, string> = {
    "Content-Type": asset.type,
    "Content-Security-Policy": assetCsp(plugin.permissions.has("network")),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-cache",
    ETag: etag,
    Vary: "Origin",
  };
  if (req.headers.get("origin") === "null") headers["Access-Control-Allow-Origin"] = "null";
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(fs.readFileSync(/*turbopackIgnore: true*/ asset.file)), { headers });
}
