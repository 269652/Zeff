import { connection } from "next/server";

/** The cards that have been on screen for a moment: from now on a fresh feed puts them last. */
export async function POST(req: Request) {
  await connection();
  const { isInstalled } = await import("@/plugins/state");
  if (!isInstalled("news")) return Response.json({ ok: false }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.map(Number) : [];
  const { markSeen } = await import("@/plugins/news/store");
  return Response.json({ ok: true, marked: markSeen(ids) });
}
