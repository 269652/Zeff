import fs from "node:fs";
import path from "node:path";
import { isInstalled } from "@/plugins/state";
import { filesDir } from "@/plugins/workspace/files";

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif" };

/** GET /api/workspace/files/:name — a picture of a page. Only what was uploaded (a hash and an extension), only pictures. */
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  if (!isInstalled("workspace")) return new Response("Plugin not installed", { status: 404 });
  const { name } = await params;
  const m = /^[0-9a-f]{24}\.(png|jpg|gif|webp|avif)$/.exec(name);
  if (!m) return new Response("Not found", { status: 404 });
  const file = path.join(filesDir(), name);
  if (!fs.existsSync(file)) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(fs.readFileSync(file)), {
    headers: { "Content-Type": TYPES[m[1]], "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=31536000, immutable", "Content-Security-Policy": "default-src 'none'; sandbox" },
  });
}
