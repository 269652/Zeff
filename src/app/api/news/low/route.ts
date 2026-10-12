import { connection } from "next/server";

/**
 * The feed has reached its end on an open page: if fresh news are running low, Zeff goes looking for new feeds now (in the
 * background — the answer comes at once) and fetches them as soon as they are added. The page then shows "N new".
 */
export async function POST() {
  await connection();
  const { isInstalled } = await import("@/plugins/state");
  if (!isInstalled("news")) return Response.json({ searching: false }, { status: 404 });
  const { discoverWhenLow, isSearching } = await import("@/plugins/news/auto-discover");
  if (isSearching()) return Response.json({ searching: true });
  void (async () => {
    try {
      if ((await discoverWhenLow()) > 0) (await import("@/lib/sync/registry")).startSync("news");
    } catch {
      // searching is a bonus
    }
  })();
  return Response.json({ searching: true });
}
