import { connection } from "next/server";
import { foreignRequest, refused } from "@/lib/request-guard";

/**
 * POST /api/learn/widgets/<id>/result — a widget's result, as the lesson page got it from the widget's frame (checked
 * there and here again): its best kept, experience for doing better. A route, not a Server Action: it must not wait
 * behind one (the teacher's session may be busy).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const why = foreignRequest(req);
  if (why) return refused(why);
  const { isInstalled } = await import("@/plugins/state");
  if (!isInstalled("learn")) return Response.json({ error: "not installed" }, { status: 404 });
  const { parseWidgetMessage } = await import("@/lib/widgets/sandbox");
  const body = await req.json().catch(() => null);
  const m = parseWidgetMessage({ ...(body ?? {}), zeffWidget: 1, type: "result" });
  if (!m || m.type !== "result") return Response.json({ error: "no result" }, { status: 400 });
  try {
    const { widgetResult } = await import("@/plugins/learn/store");
    return Response.json(widgetResult(Number((await params).id), m));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 404 });
  }
}
