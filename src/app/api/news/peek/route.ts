import { connection } from "next/server";

/**
 * The news card's look at its page (picture, summary, whole text). A route, not a server action: Next runs the
 * actions of a page one after another, and a screenful of cards would wait in one queue; routes run side by side.
 */
export async function POST(req: Request) {
  await connection();
  const { isInstalled } = await import("@/plugins/state");
  if (!isInstalled("news")) return Response.json({ ok: false, image: "", hasContent: false, summary: "" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { id?: unknown };
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ ok: false, image: "", hasContent: false, summary: "" }, { status: 400 });
  const { peekItem } = await import("@/plugins/news/peek");
  return Response.json(await peekItem(id));
}
