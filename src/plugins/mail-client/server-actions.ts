"use server";

import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";

/** A reply from the chat view: sent to the chat through its channel (Teams, WhatsApp, Signal) — as the auto-actions send. */
export async function sendChatMessageAction(channel: string, chat: string, body: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const text = String(body ?? "").trim().slice(0, 4000);
  const to = String(chat ?? "").trim();
  if (!text || !to) return { ok: false, error: t("Nothing to send.") };
  try {
    if (channel === "Teams" && isInstalled("teams")) {
      const r = await (await import("@/plugins/teams/run")).runTeamsMessage({ type: "teams-message", to, body: text });
      return r.what ? { ok: true } : { ok: false, error: t("Failed.") };
    }
    if (channel === "WhatsApp" && isInstalled("whatsapp")) {
      const r = await (await import("@/plugins/whatsapp/run")).runWhatsappMessage({ type: "whatsapp-message", chat: to, body: text });
      return r.what ? { ok: true } : { ok: false, error: t("Failed.") };
    }
    if (channel === "Signal" && isInstalled("signal")) {
      const r = await (await import("@/plugins/signal/run")).runSignalMessage({ type: "signal-message", chat: to, body: text });
      return r.what ? { ok: true } : { ok: false, error: t("Failed.") };
    }
    return { ok: false, error: t("{channel} isn't installed (Menu → Plugins).", { channel }) };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
