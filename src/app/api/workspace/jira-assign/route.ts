import { connection } from "next/server";
import { foreignRequest, refused } from "@/lib/request-guard";

/**
 * POST /api/workspace/jira-assign { rowId } — "Assign to me" on a mirrored Jira board's card: the ticket assigned to you
 * in Jira and the card shows it at once → { ok, key, assignee } or { ok: false, error }. Only from Zeff's own page.
 */
export async function POST(req: Request) {
  await connection();
  const why = foreignRequest(req);
  if (why) return refused(why);
  const body = ((await req.json().catch(() => null)) ?? {}) as { rowId?: unknown };
  try {
    const { assignJiraRowToMe } = await import("@/plugins/jira-lage/assign");
    return Response.json({ ok: true, ...(await assignJiraRowToMe(Number(body.rowId))) });
  } catch (e) {
    const { errorMessage } = await import("@/lib/errors");
    return Response.json({ ok: false, error: errorMessage(e) }, { status: 400 });
  }
}
