import { inThisAccount } from "@/db/accounts";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { saveMails, type MailInput } from "@/lib/mail/store";
import { automationEnv, driverPath } from "@/plugins/drivers";

/**
 * One WhatsApp chat's whole history (WhatsApp plugin), by hand: its earlier messages loaded until
 * none are left — with `fromPhone` the chat is opened in the automation Chrome (its unread messages
 * then count as read) and older ones fetched from your phone first. Kept with the other messages
 * (folder "WhatsApp", each once by WhatsApp's id) — so the knowledge reads them too. Old ones aren't
 * gone through for todos (the Mail-Durchsicht reads the last days only).
 */
export function pullWhatsappHistory(chat: string, opts: { fromPhone?: boolean } = {}): Promise<{ ok: boolean; message: string; chat?: string; added?: number; total?: number }> {
  // Kept in the account it was started in — whichever is switched to while it runs (up to 45 min).
  return inThisAccount(() => pullHistory(chat, opts));
}

async function pullHistory(chat: string, { fromPhone = true }: { fromPhone?: boolean }): Promise<{ ok: boolean; message: string; chat?: string; added?: number; total?: number }> {
  const flag = globalThis as { __zeffWhatsappHistory?: string | null };
  if (flag.__zeffWhatsappHistory) return { ok: false, message: t("A history is already running ({chat}).", { chat: flag.__zeffWhatsappHistory }) };
  flag.__zeffWhatsappHistory = chat;
  try {
    const { runStdioSession, resultToPayload } = await import("@/lib/jira/mcp-client");
    const out = await runStdioSession(
      { command: process.execPath, args: [driverPath("whatsapp")], env: automationEnv(), label: "WhatsApp history" },
      async (call) => resultToPayload(await call("whatsapp_history", { chat, fromPhone, openIfMissing: true })),
      45 * 60000, // a long chat from the phone: many rounds
    );
    const data = (typeof out === "string" ? (out.trim().startsWith("{") ? JSON.parse(out) : null) : out) as { chat?: string; complete?: boolean; messages?: MailInput[]; error?: string } | null;
    if (!data || !Array.isArray(data.messages)) throw new Error(typeof out === "string" ? out.replace(/^Error:\s*/, "").slice(0, 300) : (data?.error ?? t("WhatsApp delivered nothing readable.")));
    const { added } = saveMails(data.messages);
    const first = data.messages[0]?.receivedAt?.slice(0, 10);
    return {
      ok: true,
      chat: data.chat,
      added,
      total: data.messages.length,
      message: [
        first
          ? t("{chat}: {n} messages since {date}, {added} new", { chat: data.chat, n: data.messages.length, date: formatDate(first, { weekday: false, year: true }), added })
          : t("{chat}: {n} messages, {added} new", { chat: data.chat, n: data.messages.length, added }),
        data.complete ? ` — ${t("from the beginning")}` : "",
        ".",
      ].join(""),
    };
  } catch (e) {
    return { ok: false, message: errorMessage(e).slice(0, 300) };
  } finally {
    flag.__zeffWhatsappHistory = null;
  }
}
