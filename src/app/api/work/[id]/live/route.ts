import { answerPermission, sendToLive, setMode, wrapUp } from "@/lib/work/interactive";

/**
 * POST /api/work/:id/live — what you do in a live Copilot session: { do: "answer", option } /
 * { do: "send", text } / { do: "mode", mode } / { do: "wrap-up" }. A plain request (not a server
 * action): the page refreshing meanwhile (the session keeps changing it) can't cancel it.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const runId = Number((await params).id);
  const body = (await req.json().catch(() => ({}))) as { do?: string; option?: string; text?: string; mode?: string };
  try {
    if (!Number.isInteger(runId)) throw new Error("Unbekannter Lauf.");
    if (body.do === "answer") answerPermission(runId, String(body.option ?? ""));
    else if (body.do === "send") {
      const text = String(body.text ?? "").trim();
      if (!text) throw new Error("Die Nachricht ist leer.");
      sendToLive(runId, text.slice(0, 8000));
    } else if (body.do === "mode") await setMode(runId, String(body.mode ?? ""));
    else if (body.do === "wrap-up") wrapUp(runId);
    else throw new Error("Unbekannte Aktion.");
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
