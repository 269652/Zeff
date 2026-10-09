import path from "node:path";
import { clearAttention, needsSignIn, raiseLogin } from "@/lib/attention";
import { errorMessage } from "@/lib/errors";
import { saveTeamsMessages, updateTeamsSettings, type TeamsMessageInput } from "./store";

const CDP = process.env.TEAMS_CDP_ENDPOINT || process.env.ROAR_CDP_ENDPOINT || "http://127.0.0.1:9222";
/** How far back 1:1 chats (PMs) are read on each sync. */
const PM_DAYS = 90;
/** Every chat's messages of the last days too (yours, group chats): what the Ticket-Lage reads for agreements. */
const CHAT_DAYS = 3;

/** One sync at a time across the whole server (actions and the scheduler are separate module copies). */
const state = globalThis as { __zeffTeamsSyncing?: boolean };

/** Remember how the sync went, for the Teams page (and the scheduler's next turn). */
function record(ok: boolean, message: string): { ok: boolean; message: string } {
  updateTeamsSettings({ lastSyncAt: new Date().toISOString(), lastResult: message, lastOk: ok });
  return { ok, message };
}

/** Whether the automation Chrome runs — the background sync never starts it (it opens a Teams tab there, though). */
async function chromeUp(): Promise<boolean> {
  return fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(3000) })
    .then((r) => r.ok)
    .catch(() => false);
}

/**
 * Read where you were @mentioned and what colleagues wrote you (1:1) from Teams in the
 * automation Chrome — its own cache, read-only (scripts/teams-mcp.mjs) — and keep them.
 * `background`: only when Chrome runs with Teams open; by hand it may open Teams.
 */
export async function syncTeams({ background = false } = {}): Promise<{ ok: boolean; message: string }> {
  if (state.__zeffTeamsSyncing) return { ok: false, message: "A Teams sync is already running." };
  state.__zeffTeamsSyncing = true;
  try {
    if (background && !(await chromeUp())) return record(false, "The automation Chrome isn't running. Not synced.");
    const { runStdioSession, resultToPayload } = await import("@/lib/jira/mcp-client");
    const script = path.join(/*turbopackIgnore: true*/ process.cwd(), "scripts", "teams-mcp.mjs");
    const out = await runStdioSession(
      { command: process.execPath, args: [script], env: {}, label: "Teams sync" },
      // Teams not open: a tab for it (Chrome itself started only by hand).
      async (call) => resultToPayload(await call("teams_messages", { pmDays: PM_DAYS, chatDays: CHAT_DAYS, openIfMissing: true, launch: !background })),
      180000,
    );
    const data = (typeof out === "string" ? JSON.parse(out) : out) as { messages?: TeamsMessageInput[]; unresolved?: number };
    if (!Array.isArray(data.messages)) throw new Error(typeof out === "string" ? out.slice(0, 300) : "Teams returned nothing readable.");
    const { added, total } = saveTeamsMessages(data.messages);
    clearAttention("login:teams");
    return record(true, `${added} new · ${total} in all`);
  } catch (e) {
    const message = errorMessage(e).slice(0, 300);
    // Teams wants you to sign in: asked of you (and pinged) — never done by Zeff.
    if (needsSignIn(message)) raiseLogin("teams", message);
    return record(false, message);
  } finally {
    state.__zeffTeamsSyncing = false;
  }
}
