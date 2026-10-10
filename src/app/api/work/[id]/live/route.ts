import { isInstalled } from "@/plugins/state";
import { answerPermission, sendToLive, setMode, wrapUp } from "@/plugins/copilot-cli/interactive";
import { foreignRequest, refused } from "@/lib/request-guard";

/**
 * POST /api/work/:id/live — what you do in a live Copilot session: { do: "answer", option } /
 * { do: "send", text } / { do: "mode", mode } / { do: "wrap-up" }. A plain request (not a server
 * action): the page refreshing meanwhile (the session keeps changing it) can't cancel it. Only from
 * Zeff's own page (the agent has a shell): not another website's, and only as JSON.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isInstalled("work")) return new Response("Plugin not installed", { status: 404 });
  const why = foreignRequest(req) ?? (/^application\/json/i.test(req.headers.get("content-type") ?? "") ? null : "not JSON");
  if (why) return refused(why);
  const runId = Number((await params).id);
  const body = (await req.json().catch(() => ({}))) as { do?: string; option?: string; text?: string; mode?: string };
  try {
    if (!Number.isInteger(runId)) throw new Error("Unknown run.");
    if (body.do === "answer") answerPermission(runId, String(body.option ?? ""));
    else if (body.do === "send") {
      const text = String(body.text ?? "").trim();
      if (!text) throw new Error("The message is empty.");
      sendToLive(runId, text.slice(0, 8000));
    } else if (body.do === "mode") await setMode(runId, String(body.mode ?? ""));
    else if (body.do === "wrap-up") wrapUp(runId);
    else throw new Error("Unknown action.");
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
