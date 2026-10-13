import { connection } from "next/server";

/**
 * "More like this" on a card: the article is read, set next to what you like and what Zeff knows about you, the AI plans searches,
 * the internet is searched and the best answers become cards that open below the card. A route (it takes up to a minute), not a
 * server action: Next runs a page's actions one after another and everything else would wait.
 */
export async function POST(req: Request) {
  await connection();
  const { isInstalled } = await import("@/plugins/state");
  if (!isInstalled("news")) return Response.json({ ok: false, error: "The News plugin is not installed." }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { id?: unknown };
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ ok: false, error: "No item." }, { status: 400 });
  const { moreLikeThis } = await import("@/plugins/news/similar");
  const r = await moreLikeThis(id);
  // New sources found for it are fetched now, in the background.
  if (r.ok && r.sourcesAdded > 0) (await import("@/lib/sync/registry")).startSync("news");
  return Response.json(r);
}
