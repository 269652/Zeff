import { connection } from "next/server";
import { busyThings } from "@/lib/host/busy";

/**
 * What this server is doing right now that a restart would cut off — work that lives only in its
 * memory: a Ticket-Lage run's own steps after the Lage (mail and note reviews, the relations, the
 * auto-actions; the run's row says "ok" already), syncs from the menu or the scheduler, a Keep
 * board sync, a Keep read, the search for people's dates. `npm run deploy` waits for it.
 * (With a sync host that is the host's list — ask the host; the web server has none of it.)
 */
export async function GET() {
  await connection();
  return Response.json({ busy: busyThings() });
}
