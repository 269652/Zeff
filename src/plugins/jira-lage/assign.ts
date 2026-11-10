/**
 * "Assign to me" on a card of a mirrored Jira board: the ticket assigned to you in Jira, through Zeff's Jira connection
 * — then read back from Jira who has it now, and that put on the card at once (the next sync would bring the same; you
 * see it right away). Only on your click. Server only.
 */
import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { resultToPayload, runStdioSession } from "@/lib/jira/mcp-client";
import { getJiraSyncConfig } from "@/lib/jira/sync";
import { databaseSource, KEY_PROP } from "@/plugins/workspace/collections";
import { getPage, rawRows, setCell } from "@/plugins/workspace/store";
import { jiraUsername, rememberJiraName } from "./me";

/** The card's Assignee property (to-workspace.ts). */
const ASSIGNEE = "jiraassignee";

/** Who you are in Jira — the user Zeff's Jira connection signs in as (its JIRA_USERNAME: your login or e-mail). */
const me = jiraUsername;

/** The ticket of a mirrored Jira board's card assigned to you — in Jira and on the card. Its key and who has it now. */
export async function assignJiraRowToMe(rowId: number): Promise<{ key: string; assignee: string }> {
  const page = getPage(rowId);
  const dbId = page?.dbId ?? null;
  if (!dbId || !(databaseSource(dbId) ?? "").startsWith("jira")) throw new ValidationError(t("This card isn't from a Jira board."));
  const row = rawRows(dbId).find((r) => r.id === rowId);
  const key = typeof row?.cells[KEY_PROP] === "string" ? String(row.cells[KEY_PROP]).trim() : "";
  if (!key) throw new ValidationError(t("This card has no Jira key."));
  const cfg = getJiraSyncConfig();
  if (!cfg.configured || !cfg.command) throw new ValidationError(t("Jira isn't set up — see the Jira tab."));
  const user = me();
  if (!user) throw new ValidationError(t("Zeff doesn't know your Jira user — its Jira connection has no JIRA_USERNAME."));
  const assignee = await runStdioSession(
    { command: cfg.command, args: cfg.args, env: cfg.env, label: "Jira" },
    async (call) => {
      await call("jira_update_issue", { issue_key: key, fields: JSON.stringify({ assignee: user }) });
      // Who has it now, as Jira names them (the board shows display names).
      const issue = resultToPayload(await call("jira_get_issue", { issue_key: key, fields: "assignee" })) as {
        fields?: { assignee?: { displayName?: string; display_name?: string } | string | null };
        assignee?: { displayName?: string; display_name?: string; name?: string } | string | null;
      };
      const a = issue?.fields?.assignee ?? issue?.assignee;
      return typeof a === "string" ? a : (a?.displayName ?? a?.display_name ?? (a as { name?: string } | null)?.name ?? user);
    },
    60000,
  );
  setCell(rowId, ASSIGNEE, assignee);
  // How Jira names you — "Find tickets for me" knows your tickets by it (pick.ts).
  rememberJiraName(assignee);
  return { key, assignee };
}
