/** The Teams plugin's action, run: a 1:1 message through the Teams driver in the automation Chrome. Server only. */
import type { TodoOp } from "@/lib/boards/shared";
import { resultToPayload, runStdioSession } from "@/lib/jira/mcp-client";
import { saveTeamsMessages, type TeamsMessageInput } from "@/lib/teams/store";
import { automationEnv, driverPath } from "../drivers";
import type { ActionResult } from "../actions/run-types";

/** A 1:1 Teams message, through the Teams driver (src/plugins/teams/driver.mjs) in the automation Chrome. */
type SentTeams = { to: string; newChat: boolean; away: string | null; message: (TeamsMessageInput & { link: string; sentAt: number }) | null };
async function sendTeamsMessage(to: string, body: string): Promise<SentTeams> {
  const script = driverPath("teams");
  return runStdioSession(
    { command: process.execPath, args: [script], env: automationEnv(), label: "Teams" },
    async (call) => resultToPayload(await call("teams_send", { to, text: body })) as SentTeams,
    180000,
  );
}

/** Send it — kept (its link, a badge) and named on the todo, so it's known it went out. */
export async function runTeamsMessage(op: Extract<TodoOp, { type: "teams-message" }>): Promise<ActionResult> {
      const r = await sendTeamsMessage(op.to, op.body);
      // The sent message kept (its link, a badge) and named on the todo — so it's known it went out.
      if (r.message) saveTeamsMessages([r.message]);
      const at = new Date(r.message?.sentAt ?? Date.now()).toLocaleString("de-DE", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
      return {
        what: `Teams-Nachricht an ${r.to} gesendet${r.newChat ? " (neuer Chat)" : ""}${r.message ? `: ${r.message.link}` : ""}${r.away ? ` — Hinweis: ${r.away}` : ""}`,
        ref: r.message ? `teams:${r.message.key}` : undefined,
        todoNote: `Teams-Nachricht an ${r.to} gesendet am ${at}${r.away ? ` (${r.away})` : ""}.`,
      };
    }
