/**
 * Who you are in Jira, as far as Zeff knows: the display name of the tickets synced as yours, the name Jira gave back the
 * last time "Assign to me" ran, and the login of Zeff's Jira connection (JIRA_USERNAME: a login or an e-mail). And the
 * mirrored Jira boards' databases. Server only.
 */
import { getPref, setPref } from "@/lib/prefs";
import { getJiraSyncConfig } from "@/lib/jira/sync";
import { getSqlite } from "@/db";
import { databaseSource } from "@/plugins/workspace/collections";
import { getDatabase } from "@/plugins/workspace/store";

/** The pref keeping the display name Jira gave back on "Assign to me". */
const ME_NAME = "jira.meName";

/** The login Zeff's Jira connection signs in as (its JIRA_USERNAME), or null. */
export function jiraUsername(): string | null {
  const cfg = getJiraSyncConfig();
  const env = (cfg as { env?: Record<string, string | undefined> }).env ?? {};
  return env.JIRA_USERNAME?.trim() || process.env.JIRA_USERNAME?.trim() || null;
}

/** Remember how Jira names you (what "Assign to me" read back). */
export function rememberJiraName(name: string): void {
  const n = name.trim();
  if (n && n !== getPref<string>(ME_NAME, "")) setPref(ME_NAME, n);
}

/** Every name Zeff knows you by in Jira (none: it can't tell which tickets are yours). */
export async function jiraMeNames(): Promise<string[]> {
  const { myJiraName } = await import("@/lib/jira/store");
  const out = [myJiraName(), getPref<string>(ME_NAME, ""), jiraUsername()].map((x) => (x ?? "").trim()).filter(Boolean);
  return [...new Set(out)];
}

/** The databases mirroring Jira boards (their source is "jira…"; "Meine Lage" isn't one). */
export function jiraBoardDatabases(): { id: number; title: string }[] {
  const d = getSqlite();
  d.exec("create table if not exists jira_board_dbs (board_id text primary key, db_id integer not null)");
  const ids = (d.prepare("select db_id from jira_board_dbs where board_id != 'jira-lage'").all() as { db_id: number }[]).map((r) => r.db_id);
  return ids
    .map((id) => getDatabase(id))
    .filter((x): x is NonNullable<typeof x> => !!x && !x.page.archivedAt && (databaseSource(x.page.id) ?? "").startsWith("jira"))
    .map((x) => ({ id: x.page.id, title: x.page.title || "Jira" }));
}

/** Whether a database mirrors a Jira board. */
export const isJiraBoard = (dbId: number): boolean => (databaseSource(dbId) ?? "").startsWith("jira") && !!getDatabase(dbId);
