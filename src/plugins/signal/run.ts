/** Signal's action, run: a message through Signal Desktop (on your click). Server only. */
import type { TodoOp } from "@/lib/boards/shared";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { resultToPayload, runStdioSession } from "@/lib/jira/mcp-client";
import type { ActionResult } from "../actions/run-types";
import { automationEnv, driverPath } from "../drivers";

export async function runSignalMessage(op: Extract<TodoOp, { type: "signal-message" }>): Promise<ActionResult> {
  const out = await runStdioSession(
    { command: process.execPath, args: [driverPath("signal")], env: automationEnv(), label: "Signal" },
    async (call) => resultToPayload(await call("signal_send", { chat: op.chat, text: op.body })),
    120000,
  );
  const r = (typeof out === "string" ? (out.trim().startsWith("{") ? JSON.parse(out) : null) : out) as { chat?: string; sentAt?: number; seen?: boolean } | null;
  if (!r?.chat) throw new Error(typeof out === "string" ? out.replace(/^Error:\s*/, "").slice(0, 300) : t("Signal didn't answer."));
  const at = formatDateTime(r.sentAt ?? Date.now());
  return {
    what: r.seen ? t("Signal message sent to {chat}", { chat: r.chat }) : t("Signal message sent to {chat} (not seen in the chat yet — please check quickly)", { chat: r.chat }),
    todoNote: `Signal message sent to ${r.chat} on ${at}.`,
  };
}
