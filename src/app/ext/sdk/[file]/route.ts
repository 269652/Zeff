import { manifestJsonSchema } from "@/lib/ext/schema";
import { SDK_CSS, SDK_JS } from "@/lib/ext/sdk";

/** GET /ext/sdk/zeff.js and zeff.css — what a panel loads (docs/plugins/panels.md) — and zeff-plugin.schema.json, the manifest's JSON Schema for editors. */
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const body = file === "zeff.js" ? SDK_JS : file === "zeff.css" ? SDK_CSS : file === "zeff-plugin.schema.json" ? manifestJsonSchema() : null;
  if (body === null) return new Response("Not found", { status: 404 });
  const headers: Record<string, string> = {
    "Content-Type": file === "zeff.js" ? "text/javascript; charset=utf-8" : file === "zeff.css" ? "text/css; charset=utf-8" : "application/schema+json; charset=utf-8",
    "Cache-Control": "no-cache",
    Vary: "Origin",
  };
  // A panel's frame has no origin of its own ("null"): module scripts and fonts need it said.
  if (req.headers.get("origin") === "null") headers["Access-Control-Allow-Origin"] = "null";
  return new Response(body, { headers });
}
