import { connection } from "next/server";
import { foreignRequest, refused } from "@/lib/request-guard";

/** GET /api/learn/snapshots/<id> — a try's snapshot (the widget as it looked): its body, title and libraries. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const why = foreignRequest(req);
  if (why) return refused(why);
  const { isInstalled } = await import("@/plugins/state");
  if (!isInstalled("learn")) return Response.json({ error: "not installed" }, { status: 404 });
  const s = (await import("@/plugins/learn/store")).widgetSnapshot(Number((await params).id));
  return s ? Response.json(s) : Response.json({ error: "no such snapshot" }, { status: 404 });
}
