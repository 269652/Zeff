import fs from "node:fs";
import { contentTypeOf, libFile } from "@/lib/widgets/libs";

/**
 * GET /api/widgets/lib/<library>/<file> — the libraries a widget may use (KaTeX, JSXGraph, three.js, Chart.js), from
 * node_modules: only inside each library's folder (lib/widgets/libs.ts). A widget's frame has no origin of its own, so
 * any origin may load them (fonts need it); they are public files, kept a day.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const file = libFile((path ?? []).join("/"));
  if (!file || !fs.existsSync(file)) return new Response("Not found", { status: 404 });
  return new Response(fs.readFileSync(file), {
    headers: { "content-type": contentTypeOf(file)!, "cache-control": "public, max-age=86400", "access-control-allow-origin": "*", "cross-origin-resource-policy": "cross-origin" },
  });
}
