/** The Teams plugin's action, run: a 1:1 message through the Teams driver in the automation Chrome. Server only. */
import type { TodoOp } from "@/lib/todos/shared";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n/server";
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
      const at = formatDateTime(r.message?.sentAt ?? Date.now());
      return {
        what: [
          r.newChat ? t("Teams message sent to {to} (new chat)", { to: r.to }) : t("Teams message sent to {to}", { to: r.to }),
          r.message ? `: ${r.message.link}` : "",
          r.away ? ` — ${t("note: {away}", { away: r.away })}` : "",
        ].join(""),
        ref: r.message ? `teams:${r.message.key}` : undefined,
        todoNote: `Teams message sent to ${r.to} on ${at}${r.away ? ` (${r.away})` : ""}.`,
      };
    }
