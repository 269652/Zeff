import { isInstalled } from "@/plugins/state";
import { readLog } from "@/lib/work/log";
import { getRun } from "@/lib/work/store";

/** GET /api/work/:id/log?from=n — a work run's log lines from n on (condensed), and its state. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isInstalled("work")) return new Response("Plugin not installed", { status: 404 });
  const { id } = await params;
  const run = Number.isInteger(Number(id)) ? getRun(Number(id)) : undefined;
  if (!run) return Response.json({ error: "Not found" }, { status: 404 });
  const from = Math.max(0, Number(new URL(req.url).searchParams.get("from")) || 0);
  const { lines, errors } = readLog(run.id);
  // A live session: whether it is working on an answer now (busy) — from the server that follows it (on the phone's
  // server: asked of Zeff's own); null when not known.
  const busy = run.status === "running" ? (await (await import("@/lib/work/live-state")).liveState(run.id)).busy : false;
  return Response.json(
    { status: run.status, busy, lines: lines.slice(from), next: lines.length, errors, startedAt: run.startedAt, finishedAt: run.finishedAt },
    { headers: { "Cache-Control": "no-store" } },
  );
}
