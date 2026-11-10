import { isInstalled } from "@/plugins/state";
import { liveDo, type LiveBody } from "@/lib/work/live-actions";
import { delegates } from "@/lib/host/role";
import { foreignRequest, refused } from "@/lib/request-guard";
import { t } from "@/lib/i18n/server";

/**
 * POST /api/work/:id/live — what you do in a live session.
 *
 * Copilot: { do: "answer", option } / { do: "send", text } / { do: "mode", mode } / { do: "wrap-up" }.
 * Claude: { do: "send", text, images? } / { do: "answer", requestId, answer } / { do: "interrupt" } /
 * { do: "mode", mode } / { do: "model", model } / { do: "effort", effort } / { do: "shell", cmd } /
 * { do: "wrap-up" } (its result: ends the run) / { do: "close" } (ends it without one).
 *
 * A plain request (not a server action): the page refreshing meanwhile (the session keeps
 * changing it) can't cancel it. Only from Zeff's own page (the agent has a shell): not another
 * website's, and only as JSON.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isInstalled("work")) return new Response("Plugin not installed", { status: 404 });
  const why = foreignRequest(req) ?? (/^application\/json/i.test(req.headers.get("content-type") ?? "") ? null : "not JSON");
  if (why) return refused(why);
  const runId = Number((await params).id);
  const body = (await req.json().catch(() => ({}))) as LiveBody;
  try {
    if (!Number.isInteger(runId)) throw new Error(t("Unknown run."));
    // The phone's server only watches the sessions: what you do goes to Zeff's own, which follows them and acts.
    if (delegates()) {
      const { callHost } = await import("@/lib/host/client");
      const out = await callHost<Record<string, unknown>>("work.liveDo", { runId, body }, 120000);
      return Response.json({ ok: true, ...out });
    }
    return Response.json({ ok: true, ...(await liveDo(runId, body)) });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
