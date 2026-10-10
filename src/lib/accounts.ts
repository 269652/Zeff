import { closeAccountDb } from "@/db";
import { accountById, addAccount, currentAccountId, removeAccount, setActiveAccount, withAccount, type Account } from "@/db/accounts";
import { writeKnowledgeInstances } from "@/plugins/knowledge/instances";
import { forgetBranchWork } from "./branches";
import { emitChange } from "./events";
import { runsByStatus } from "./work/store";

/**
 * Switching accounts (Accounts plugin): only while nothing runs — a sync, a Lage, a worker, a
 * backup would otherwise carry on in the other account's database. What's on the way, in words
 * (null: nothing).
 */
export function accountBusy(): string | null {
  const g = globalThis as Record<string, unknown> & {
    __zeffSyncs?: { running: Set<string>; all: unknown };
    __zeffBackups?: Map<string, unknown>;
  };
  const busy: string[] = [];
  if (g.__zeffSyncs?.running.size || g.__zeffSyncs?.all) busy.push("ein Sync");
  if (g.__zeffTeamsSyncing || g.__zeffMailSyncing || g.__zeffGitlabSyncing) busy.push("ein Sync");
  if (g.__zeffBoardRun) busy.push("die Ticket-Lage");
  if (g.__zeffRecap) busy.push("ein Tagesrückblick");
  if (g.__zeffMailTodos || g.__zeffMailRelations || g.__zeffAutoActions || g.__zeffBoardLage) busy.push("eine Auswertung");
  if (g.__zeffBackups?.size) busy.push("ein Backup");
  const runs = runsByStatus(["queued", "running"]).length;
  if (runs) busy.push(runs === 1 ? "ein Work-Lauf" : `${runs} Work-Läufe`);
  return busy.length ? [...new Set(busy)].join(", ") : null;
}

/** Into another account: its data, settings and plugins from now on. */
export function switchAccount(id: string): Account {
  const a = accountById(id);
  if (!a) throw new Error("Unbekanntes Konto.");
  if (id === currentAccountId()) return a;
  const busy = accountBusy();
  if (busy) throw new Error(`Gerade läuft ${busy} — wechseln, sobald es fertig ist.`);
  setActiveAccount(id);
  writeKnowledgeInstances(); // https://knowledge.zeff follows the account you're in
  // What's kept in memory belongs to the account before.
  forgetBranchWork();
  (globalThis as { __zeffAttention?: Map<string, unknown> }).__zeffAttention?.clear();
  emitChange("attention");
  return a;
}

/**
 * A new account — empty, or with the settings and configuration of another (AI backends, LLM
 * instructions, installed plugins, repos, boards, report rules …), not its data.
 */
export async function createAccount(v: { name: string; color: string; copyFrom?: string }): Promise<{ account: Account; copied: number }> {
  const from = v.copyFrom ? accountById(v.copyFrom) : undefined;
  if (v.copyFrom && !from) throw new Error("Das Konto zum Übernehmen gibt es nicht.");
  const account = addAccount(v.name, v.color);
  let copied = 0;
  if (from) {
    const { exportConfig, importConfig } = await import("@/plugins/backup/config");
    const config = withAccount(from.id, exportConfig);
    copied = withAccount(account.id, () => importConfig(config)).rows;
  }
  writeKnowledgeInstances(); // with Knowledge taken over, its own knowledge server
  return { account, copied };
}

/** An account off the list (its folder set aside, not deleted). Where it went. */
export function deleteAccount(id: string): string {
  if (id === currentAccountId()) throw new Error("Erst in ein anderes Konto wechseln.");
  closeAccountDb(id);
  const to = removeAccount(id);
  writeKnowledgeInstances(); // its knowledge server stops (its data went along to the set-aside folder)
  return to;
}
