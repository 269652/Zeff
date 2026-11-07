import { slowJson } from "@/lib/slow-response";
import { askDatabaseAction } from "@/plugins/workspace/actions";

/** POST /api/workspace/ask — a view's <ask>. A route for the reason /api/workspace/lookup is one: the AI takes its time, the page goes on. */
export async function POST(req: Request) {
  if (!req.headers.get("content-type")?.startsWith("application/json")) return Response.json({ ok: false, error: "JSON only" }, { status: 415 });
  const b = (await req.json().catch(() => null)) as { dbId?: unknown; question?: unknown } | null;
  return slowJson(() => askDatabaseAction(Number(b?.dbId), String(b?.question ?? "")));
}
