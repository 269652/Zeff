/** WhatsApp's action, run: a message through WhatsApp Web in the automation Chrome (on your click). Server only. */
import type { TodoOp } from "@/lib/boards/shared";
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
  if (!r?.chat) throw new Error(typeof out === "string" ? out.slice(0, 300) : "WhatsApp hat nicht geantwortet.");
  const at = new Date(r.sentAt ?? Date.now()).toLocaleString("de-DE", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
  return {
    what: `WhatsApp-Nachricht an ${r.chat} gesendet${r.seen ? "" : " (im Chat noch nicht gesehen — bitte kurz prüfen)"}`,
    todoNote: `WhatsApp-Nachricht an ${r.chat} gesendet am ${at}.`,
  };
}
