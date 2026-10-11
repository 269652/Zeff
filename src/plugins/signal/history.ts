import { inThisAccount } from "@/db/accounts";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { saveMails, type MailInput } from "@/lib/mail/store";
import { automationEnv, driverPath } from "@/plugins/drivers";

/**
 * One Signal chat's whole history (Signal plugin), by hand: its earlier messages loaded from Signal
 * Desktop until none are left — no chat opened, nothing marked read. Signal Desktop has what it got
 * since it was linked (nothing older comes from the phone). Kept with the other messages (folder
 * "Signal", each once by Signal's id) — so the knowledge reads them too.
 */
export function pullSignalHistory(chat: string): Promise<{ ok: boolean; message: string; chat?: string; added?: number; total?: number }> {
  return inThisAccount(() => pullHistory(chat));
}

async function pullHistory(chat: string): Promise<{ ok: boolean; message: string; chat?: string; added?: number; total?: number }> {
  const flag = globalThis as { __zeffSignalHistory?: string | null };
  if (flag.__zeffSignalHistory) return { ok: false, message: t("A history is already running ({chat}).", { chat: flag.__zeffSignalHistory }) };
  flag.__zeffSignalHistory = chat;
  try {
    const { runStdioSession, resultToPayload } = await import("@/lib/jira/mcp-client");
    const out = await runStdioSession(
      { command: process.execPath, args: [driverPath("signal")], env: automationEnv(), label: "Signal history" },
      async (call) => resultToPayload(await call("signal_history", { chat, launch: true })),
      15 * 60000,
    );
    const data = (typeof out === "string" ? (out.trim().startsWith("{") ? JSON.parse(out) : null) : out) as { chat?: string; complete?: boolean; messages?: MailInput[] } | null;
    if (!data || !Array.isArray(data.messages)) throw new Error(typeof out === "string" ? out.replace(/^Error:\s*/, "").slice(0, 300) : t("Signal delivered nothing readable."));
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
    flag.__zeffSignalHistory = null;
  }
}
