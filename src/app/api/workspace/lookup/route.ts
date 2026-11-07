import { slowJson } from "@/lib/slow-response";
import { lookupSearchAction } from "@/plugins/workspace/actions";

/**
 * POST /api/workspace/lookup — what a view's <lookup> asks. A route, not an action: a page's actions run one after the other, and a web
 * search takes half a minute, all of it with the page's buttons waiting behind it. JSON only: no other site's form can start one.
 */
export async function POST(req: Request) {
  if (!req.headers.get("content-type")?.startsWith("application/json")) return Response.json({ ok: false, error: "JSON only" }, { status: 415 });
  const b = (await req.json().catch(() => null)) as { source?: unknown; query?: unknown; language?: unknown; enter?: unknown } | null;
  return slowJson(() => lookupSearchAction(String(b?.source ?? ""), String(b?.query ?? ""), String(b?.language ?? ""), b?.enter === true));
}
