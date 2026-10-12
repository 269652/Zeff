import { connection } from "next/server";

/**
 * What an open News page polls: how many items were fetched since it loaded ("↑ 5 new"). If the last fetch is
 * older than half an hour the sync is started in the background (it normally runs by itself; this covers a
 * server that was off or asleep). Cheap: a count and a timestamp.
 */
export async function GET(req: Request) {
  await connection();
  const { isInstalled } = await import("@/plugins/state");
  if (!isInstalled("news")) return Response.json({ count: 0, syncing: false }, { status: 404 });
  const since = new URL(req.url).searchParams.get("since") ?? "";
  const { countNewSince, lastFetchAt, listSources } = await import("@/plugins/news/store");
  const last = lastFetchAt();
  let syncing = false;
  if (listSources().some((s) => s.enabled) && (!last || Date.now() - Date.parse(last) > 30 * 60000)) {
    const { startSync } = await import("@/lib/sync/registry");
    syncing = startSync("news").ok;
  }
  return Response.json({ count: Number.isFinite(Date.parse(since)) ? countNewSince(since) : 0, syncing, last });
}
