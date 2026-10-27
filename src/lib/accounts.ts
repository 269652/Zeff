import { closeAccountDb } from "@/db";
import { accountById, addAccount, currentAccountId, removeAccount, setActiveAccount, withAccount, type Account } from "@/db/accounts";
import { writeKnowledgeInstances } from "@/plugins/knowledge/instances";
import { t } from "@/lib/i18n/server";
import { emitChange } from "./events";

/** Into another account: its data, settings and plugins from now on. */
export function switchAccount(id: string): Account {
  const a = accountById(id);
  if (!a) throw new Error(t("Unknown account."));
  if (id === currentAccountId()) return a;
  // Whatever runs carries on: every account syncs, briefs and works in the background, each in its own database
  // (its runs and flags kept per account) — the switch only changes which one localhost shows.
  setActiveAccount(id);
  writeKnowledgeInstances(); // https://knowledge.zeff follows the account you're in
  emitChange("attention");
  return a;
}

/** Preferences that are configuration (not state): the menu, what the AI reads, the plugins' settings. */
const CONFIG_PREF = /^(menu|layout|auswerten|plugin:.+)$/;

/**
 * A new account — empty, or with the settings and configuration of another (AI backends, LLM
 * instructions, installed plugins, repos, boards, report rules, the menu, sync intervals …), not
 * its data. `shareChrome`: it uses the other's automation Chrome — its sign-ins — instead of its own.
 * Its setup assistant is to come (not taken over as done).
 */
export async function createAccount(v: { name: string; color: string; copyFrom?: string; shareChrome?: boolean }): Promise<{ account: Account; copied: number }> {
  const from = v.copyFrom ? accountById(v.copyFrom) : undefined;
  if (v.copyFrom && !from) throw new Error(t("The account to copy from doesn't exist."));
  const account = addAccount(v.name, v.color, from && v.shareChrome ? from.id : undefined);
  let copied = 0;
  if (from) {
    const { exportConfig, importConfig } = await import("@/plugins/backup/config");
    const { getDb } = await import("@/db");
    const { prefs: prefsTable, syncState } = await import("@/db/schema");
    const { isNotNull } = await import("drizzle-orm");
    const config = withAccount(from.id, exportConfig);
    // The other's preferences that are configuration, and how often each sync runs.
    const prefs = withAccount(from.id, () => getDb().select().from(prefsTable).all()).filter((p) => CONFIG_PREF.test(p.key));
    const every = withAccount(from.id, () => getDb().select({ key: syncState.key, everyMinutes: syncState.everyMinutes }).from(syncState).where(isNotNull(syncState.everyMinutes)).all());
    copied = withAccount(account.id, () => {
      const n = importConfig(config).rows;
      const db = getDb();
      for (const p of prefs) db.insert(prefsTable).values(p).onConflictDoUpdate({ target: prefsTable.key, set: { value: p.value } }).run();
      for (const e of every) db.insert(syncState).values(e).onConflictDoUpdate({ target: syncState.key, set: { everyMinutes: e.everyMinutes } }).run();
      return n + prefs.length + every.length;
    });
  }
  // Its setup assistant comes (taken over from the other, it would count as done).
  await withAccount(account.id, async () => {
    const { updateAppSettings } = await import("@/lib/ai");
    const { setPref } = await import("@/lib/prefs");
    updateAppSettings({ setupDoneAt: null });
    if (from) setPref("setup:from", { id: from.id, name: from.name, sharedChrome: !!v.shareChrome });
  });
  writeKnowledgeInstances(); // with Knowledge taken over, its own knowledge server
  return { account, copied };
}

/** Into a new account and its setup assistant (it starts again, done or not). */
export async function startSetup(id: string): Promise<void> {
  switchAccount(id);
  const { updateAppSettings } = await import("@/lib/ai");
  withAccount(id, () => updateAppSettings({ setupDoneAt: null }));
}

/** An account off the list (its folder set aside, not deleted). Where it went. */
export function deleteAccount(id: string): string {
  if (id === currentAccountId()) throw new Error(t("Switch to another account first."));
  closeAccountDb(id);
  const to = removeAccount(id);
  writeKnowledgeInstances(); // its knowledge server stops (its data went along to the set-aside folder)
  return to;
}
