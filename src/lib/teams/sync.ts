import { automationEnv, automationUp, driverPath } from "@/plugins/drivers";
import { driverOf } from "@/lib/connectors/store";
import { clearAttention, needsSignIn, raiseLogin } from "@/lib/attention";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { saveTeamsMessages, updateTeamsSettings, type TeamsMessageInput } from "./store";
import { accountFlag, setAccountFlag } from "@/lib/sync/account-flags";

/** How far back 1:1 chats (PMs) are read on each sync. */
const PM_DAYS = 90;
/** Every chat's messages of the last days too (yours, group chats): what the Ticket-Lage reads for agreements. */
const CHAT_DAYS = 3;

/** One sync at a time across the whole server (actions and the scheduler are separate module copies). */

/** Remember how the sync went, for the Teams page (and the scheduler's next turn). */
function record(ok: boolean, message: string): { ok: boolean; message: string } {
  updateTeamsSettings({ lastSyncAt: new Date().toISOString(), lastResult: message, lastOk: ok });
  return { ok, message };
}

/** Whether the automation Chrome runs — the background sync never starts it (it opens a Teams tab there, though). */
async function chromeUp(): Promise<boolean> {
  return automationUp("teams");
}

/**
 * Read where you were @mentioned and what colleagues wrote you (1:1) from Teams in the
 * automation Chrome — its own cache, read-only (src/plugins/teams/driver.mjs) — and keep them.
 * `background`: only when Chrome runs with Teams open; by hand it may open Teams.
 */
export async function syncTeams({ background = false } = {}): Promise<{ ok: boolean; message: string }> {
  if (accountFlag("__zeffTeamsSyncing")) return { ok: false, message: t("A Teams sync is already running.") };
  setAccountFlag("__zeffTeamsSyncing", true);
  try {
    // Through Graph (the API driver) no Chrome is needed; else, in the background without the automation Chrome: later — not a failure.
    const viaApi = driverOf("teams") === "api";
    if (!viaApi && background && !(await chromeUp())) return { ok: true, message: t("The automation Chrome isn't running — later.") };
    let data: { messages?: TeamsMessageInput[]; unresolved?: number };
    if (viaApi) data = await (await import("@/lib/microsoft/teams-api")).readTeams({ pmDays: PM_DAYS, chatDays: CHAT_DAYS });
    else {
      const { runStdioSession, resultToPayload } = await import("@/lib/jira/mcp-client");
      const script = driverPath("teams");
      const out = await runStdioSession(
        { command: process.execPath, args: [script], env: automationEnv(), label: "Teams sync" },
        // Teams not open: a tab for it (Chrome itself started only by hand).
        async (call) => resultToPayload(await call("teams_messages", { pmDays: PM_DAYS, chatDays: CHAT_DAYS, openIfMissing: true, launch: !background })),
        180000,
      );
      data = (typeof out === "string" ? JSON.parse(out) : out) as { messages?: TeamsMessageInput[]; unresolved?: number };
      if (!Array.isArray(data.messages)) throw new Error(typeof out === "string" ? out.slice(0, 300) : t("{source} returned nothing readable.", { source: "Teams" }));
    }
    const { added, total } = saveTeamsMessages(data.messages ?? []);
    clearAttention("login:teams");
    return record(true, t("{added} new · {total} in all", { added, total }));
  } catch (e) {
    const message = errorMessage(e).slice(0, 300);
    // Teams wants you to sign in: asked of you (and pinged) — never done by Zeff.
    if (driverOf("teams") === "cdp" && needsSignIn(message)) raiseLogin("teams", message);
    return record(false, message);
  } finally {
    setAccountFlag("__zeffTeamsSyncing", false);
  }
}
