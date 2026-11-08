import { libBundle } from "@/lib/widgets/libs";

/**
 * GET /api/widgets/bundle?libs=katex,jsxgraph — the libraries' code and CSS as text (KaTeX's fonts inlined), for the
 * page to put into a widget's frame: the frame itself loads nothing (on the phone it couldn't reach Zeff). Public
 * open-source files, kept a day by the browser.
 */
export async function GET(req: Request) {
  const libs = (new URL(req.url).searchParams.get("libs") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 8);
  return Response.json(libBundle(libs), { headers: { "cache-control": "public, max-age=86400" } });
}
