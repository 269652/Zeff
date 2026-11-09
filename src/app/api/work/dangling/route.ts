import { connection } from "next/server";
import { foreignRequest, refused } from "@/lib/request-guard";

/**
 * GET /api/work/dangling — the runs that count as running but aren't working (sessions waiting for you or left over
 * from before a restart, workers whose process is gone) and how many runs wait for a worker.
 * POST — "Kill all dangling sessions": each stopped, their workers free, the queue goes on → { ok, ended }.
 * A route, not a Server Action (a page older than the server still reaches it).
 */
export async function GET() {
  await connection();
  const { isInstalled } = await import("@/plugins/state");
  if (!isInstalled("work")) return Response.json({ dangling: [], queued: 0 });
  const { danglingRuns } = await import("@/lib/work/runner");
  const { runsByStatus } = await import("@/lib/work/store");
  return Response.json({ dangling: danglingRuns(), queued: runsByStatus(["queued"]).length });
}

export async function POST(req: Request) {
  await connection();
  const why = foreignRequest(req);
  if (why) return refused(why);
  const { isInstalled } = await import("@/plugins/state");
  if (!isInstalled("work")) return Response.json({ ok: false, error: "not installed" }, { status: 404 });
  try {
    const { endDanglingRuns } = await import("@/lib/work/runner");
    return Response.json({ ok: true, ...endDanglingRuns() });
  } catch (e) {
    const { errorMessage } = await import("@/lib/errors");
    return Response.json({ ok: false, error: errorMessage(e) }, { status: 500 });
  }
}
