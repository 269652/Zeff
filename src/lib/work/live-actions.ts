/**
 * What you do in a live session (POST /api/work/:id/live) — here, on the server that follows the session: Zeff's own.
 * The phone's server (which only watches) hands it over (host op "work.liveDo"). Server only.
 */
import { answerPermission, sendToLive, setMode, wrapUp } from "@/plugins/copilot-cli/interactive";
import { liveDriverOf, type LiveDriver } from "@/lib/work/live-driver";
import { EFFORTS, type AskAnswer, type Effort } from "@/lib/work/shared";
import { t } from "@/lib/i18n/server";

/** Images with a message: at most this many, each at most this big (base64 of it). */
const MAX_IMAGES = 6;
const MAX_IMAGE = 7 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export type LiveBody = {
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

/** An action on a run's live session (its driver following it here — taken up if not yet); what it answers. */
export async function liveDo(runId: number, body: LiveBody): Promise<Record<string, unknown>> {
  const driver = liveDriverOf(runId);
  if (driver && !driver.view(runId)) driver.reattach([runId]);
  if (driver?.view(runId)) {
    const out = await session(driver, runId, body);
    return out;
  }
  if (body.do === "answer") answerPermission(runId, String(body.option ?? ""));
  else if (body.do === "send") {
    const text = String(body.text ?? "").trim();
    if (!text) throw new Error(t("The message is empty."));
    sendToLive(runId, text.slice(0, 8000));
  } else if (body.do === "mode") await setMode(runId, String(body.mode ?? ""));
  else if (body.do === "wrap-up") wrapUp(runId);
  else throw new Error(t("Unknown action."));
  return {};
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
