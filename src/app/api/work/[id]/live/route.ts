import { isInstalled } from "@/plugins/state";
import { answerPermission, sendToLive, setMode, wrapUp } from "@/plugins/copilot-cli/interactive";
import { liveDriverOf, type LiveDriver } from "@/lib/work/live-driver";
import { EFFORTS, type AskAnswer, type Effort } from "@/lib/work/shared";
import { foreignRequest, refused } from "@/lib/request-guard";
import { t } from "@/lib/i18n/server";

/** Images with a message: at most this many, each at most this big (base64 of it). */
const MAX_IMAGES = 6;
const MAX_IMAGE = 7 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

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
  const body = (await req.json().catch(() => ({}))) as {
    do?: string;
    option?: string;
    text?: string;
    mode?: string;
    model?: string;
    effort?: string;
    cmd?: string;
    requestId?: string;
    answer?: AskAnswer;
    images?: { mediaType?: string; data?: string }[];
  };
  try {
    if (!Number.isInteger(runId)) throw new Error(t("Unknown run."));
    // A live session (any provider's driver that has it running).
    const driver = liveDriverOf(runId);
    if (driver?.view(runId)) {
      const out = await session(driver, runId, body);
      return Response.json({ ok: true, ...out });
    }
    if (body.do === "answer") answerPermission(runId, String(body.option ?? ""));
    else if (body.do === "send") {
      const text = String(body.text ?? "").trim();
      if (!text) throw new Error(t("The message is empty."));
      sendToLive(runId, text.slice(0, 8000));
    } else if (body.do === "mode") await setMode(runId, String(body.mode ?? ""));
    else if (body.do === "wrap-up") wrapUp(runId);
    else throw new Error(t("Unknown action."));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

type ClaudeBody = { do?: string; text?: string; mode?: string; model?: string; effort?: string; cmd?: string; requestId?: string; answer?: AskAnswer; images?: { mediaType?: string; data?: string }[] };

async function session(d: LiveDriver, runId: number, b: ClaudeBody) {
  switch (b.do) {
    case "send": {
      const text = String(b.text ?? "").trim();
      const images = (b.images ?? []).slice(0, MAX_IMAGES).map((i) => {
        const mediaType = String(i.mediaType ?? "");
        const data = String(i.data ?? "");
        if (!IMAGE_TYPES.includes(mediaType)) throw new Error(t("Not an image Claude reads ({type}): PNG, JPEG, GIF or WebP.", { type: mediaType || "?" }));
        if (!data || data.length > MAX_IMAGE || !/^[A-Za-z0-9+/=]+$/.test(data)) throw new Error(t("An image is too big (5 MB at most) or unreadable."));
        return { mediaType, data };
      });
      if (!text && !images.length) throw new Error(t("The message is empty."));
      await d.send(runId, text.slice(0, 100000) || "(see the image)", images);
      return {};
    }
    case "answer": {
      if (!b.requestId || !b.answer || (b.answer.behavior !== "allow" && b.answer.behavior !== "deny")) throw new Error(t("Which answer?"));
      const a = b.answer;
      if (a.then !== undefined && !d.view(runId)?.session.modes.some((m) => m.id === a.then)) throw new Error(t("Unknown mode."));
      await d.answer(runId, b.requestId, {
        behavior: a.behavior,
        always: !!a.always,
        message: typeof a.message === "string" ? a.message.slice(0, 4000) : undefined,
        interrupt: !!a.interrupt,
        answers: a.answers && typeof a.answers === "object" ? Object.fromEntries(Object.entries(a.answers).map(([k, v]) => [String(k).slice(0, 500), String(v).slice(0, 2000)])) : undefined,
        then: a.then,
        input: a.input && typeof a.input === "object" ? a.input : undefined,
      });
      return {};
    }
    case "interrupt":
      await d.interrupt(runId);
      return {};
    case "mode":
      await d.setMode(runId, String(b.mode ?? ""));
      return {};
    case "model":
      await d.setModel(runId, String(b.model ?? ""));
      return {};
    case "effort": {
      const effort = String(b.effort ?? "");
      if (!(EFFORTS as readonly string[]).includes(effort)) throw new Error(t("Unknown effort."));
      if (!d.setEffort) throw new Error(t("This session's effort can't be changed."));
      await d.setEffort(runId, effort as Effort);
      return {};
    }
    case "shell": {
      const cmd = String(b.cmd ?? "").trim();
      if (!cmd) throw new Error(t("Which command?"));
      if (!d.shell) throw new Error(t("This session doesn't run commands of yours."));
      const r = await d.shell(runId, cmd.slice(0, 8000));
      return { out: r.out.slice(-20000), code: r.code };
    }
    case "wrap-up":
      await d.finish(runId);
      return {};
    case "close":
      await d.close(runId);
      return {};
    default:
      throw new Error(t("Unknown action."));
  }
}
