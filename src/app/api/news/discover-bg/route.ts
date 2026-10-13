import { connection } from "next/server";

/** At most this often a scroll starts a quiet Discover in the background. */
const EVERY_MS = 10 * 60_000;

/**
 * The reader is scrolling on: Zeff keeps searching meanwhile — the written taste description plans searches, the web and new
 * sources are brought in. The page then shows "N new". Starts nothing while one runs, within ten minutes of the last, or
 * without a taste to go by.
 */
export async function POST() {
  await connection();
  const { isInstalled } = await import("@/plugins/state");
  if (!isInstalled("news")) return Response.json({ started: false }, { status: 404 });
  const { getDiscoverStatus, startDiscover } = await import("@/plugins/news/discover-job");
  const { tasteReady } = await import("@/plugins/news/taste");
  const st = getDiscoverStatus();
  const last = st.finishedAt ? Date.parse(st.finishedAt) : 0;
  if (st.running || Date.now() - last < EVERY_MS || !tasteReady()) return Response.json({ started: false });
  startDiscover();
  return Response.json({ started: true });
}
