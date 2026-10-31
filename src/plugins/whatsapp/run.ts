/** WhatsApp's action, run: a message through WhatsApp Web in the automation Chrome (on your click). Server only. */
import type { TodoOp } from "@/lib/todos/shared";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { resultToPayload, runStdioSession } from "@/lib/jira/mcp-client";
import type { ActionResult } from "../actions/run-types";
import { automationEnv, driverPath } from "../drivers";

export async function runWhatsappMessage(op: Extract<TodoOp, { type: "whatsapp-message" }>): Promise<ActionResult> {
  const out = await runStdioSession(
    { command: process.execPath, args: [driverPath("whatsapp")], env: automationEnv(), label: "WhatsApp" },
    async (call) => resultToPayload(await call("whatsapp_send", { chat: op.chat, text: op.body })),
    120000,
  );
  const r = (typeof out === "string" ? (out.trim().startsWith("{") ? JSON.parse(out) : null) : out) as { chat?: string; sentAt?: number; seen?: boolean } | null;
  if (!r?.chat) throw new Error(typeof out === "string" ? out.slice(0, 300) : t("WhatsApp didn't answer."));
  const at = formatDateTime(r.sentAt ?? Date.now());
  return {
    what: r.seen ? t("WhatsApp message sent to {chat}", { chat: r.chat }) : t("WhatsApp message sent to {chat} (not seen in the chat yet — please check quickly)", { chat: r.chat }),
    todoNote: `WhatsApp message sent to ${r.chat} on ${at}.`,
  };
}
