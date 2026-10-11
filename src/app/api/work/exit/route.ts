import { withAccount, accountById } from "@/db/accounts";
import { fromWorkHost } from "@/lib/work/host";

/**
 * POST /api/work/exit { runId, account } — the work host: this run's worker process is over. Read
 * to its end like any run (finalize). Only with the host's token, which the launcher shares with
 * the two; a run that's finished already (or unknown) is answered 200 all the same.
 */
export async function POST(req: Request) {
  if (!fromWorkHost(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { runId?: number; account?: string };
  if (!Number.isInteger(body.runId) || !body.account || !accountById(body.account)) return Response.json({ error: "unknown run" }, { status: 400 });
  // A live Claude session restarting (another effort) goes on — its end isn't the run's.
  const { claudeWorkerExited } = await import("@/plugins/claude-cli/live");
  if (withAccount(body.account, () => claudeWorkerExited(body.runId!))) return Response.json({ ok: true });
  const { finalize } = await import("@/lib/work/runner");
  // Not awaited: reading the end can take a while (delivery, git); the host needs only the receipt.
  void withAccount(body.account, () => finalize(body.runId!)).catch((e) => console.error("[work] finishing after the host's report failed:", e));
  return Response.json({ ok: true });
}
