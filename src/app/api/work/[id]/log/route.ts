import { readLog } from "@/lib/work/log";
import { getRun } from "@/lib/work/store";

/** GET /api/work/:id/log?from=n — a work run's log lines from n on (condensed), and its state. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = Number.isInteger(Number(id)) ? getRun(Number(id)) : undefined;
  if (!run) return Response.json({ error: "Not found" }, { status: 404 });
  const from = Math.max(0, Number(new URL(req.url).searchParams.get("from")) || 0);
  const { lines, errors } = readLog(run.id);
  return Response.json(
    { status: run.status, lines: lines.slice(from), next: lines.length, errors, startedAt: run.startedAt, finishedAt: run.finishedAt },
    { headers: { "Cache-Control": "no-store" } },
  );
}
