import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * A copy of an account: its configuration (preferences that are settings, sync intervals) over,
 * not its state; its sign-ins (the automation Chrome) shared on request; its setup assistant to come.
 */
test("an account made from another: settings over, Chrome shared, setup to come", async () => {
  const { setAccountsInstalled, accountChrome, withAccount, DEFAULT_ACCOUNT } = await import("@/db/accounts");
  const { createAccount } = await import("@/lib/accounts");
  const { getPref, setPref } = await import("@/lib/prefs");
  const { getAppSettings, updateAppSettings } = await import("@/lib/ai");
  const { getDb } = await import("@/db");
  const { syncState } = await import("@/db/schema");
  setAccountsInstalled(true);

  withAccount(DEFAULT_ACCOUNT, () => {
    setPref("menu", { place: { "/keep": "header" }, hidden: [], order: ["/todos"] });
    setPref("gmail:full:0", ["msg-a:1"]); // state: not taken over
    getDb().insert(syncState).values({ key: "mail", everyMinutes: 30 }).run();
    updateAppSettings({ setupDoneAt: new Date().toISOString() });
  });

  const shared = (await createAccount({ name: "Arbeit Kopie", color: "sky", copyFrom: DEFAULT_ACCOUNT, shareChrome: true })).account;
  withAccount(shared.id, () => {
    assert.deepEqual(getPref("menu", null), { place: { "/keep": "header" }, hidden: [], order: ["/todos"] });
    assert.equal(getPref("gmail:full:0", null), null);
    assert.equal(getDb().select().from(syncState).all().find((s) => s.key === "mail")?.everyMinutes, 30);
    assert.equal(getAppSettings().setupDoneAt, null);
    assert.deepEqual(getPref("setup:from", null), { id: DEFAULT_ACCOUNT, name: "Default", sharedChrome: true });
  });
  assert.equal(accountChrome(shared.id).port, accountChrome(DEFAULT_ACCOUNT).port);

  const own = (await createAccount({ name: "Arbeit eigen", color: "rose", copyFrom: DEFAULT_ACCOUNT })).account;
  assert.notEqual(accountChrome(own.id).port, accountChrome(DEFAULT_ACCOUNT).port);
});

/**
 * Into another account: it syncs from the switch on — no run of its was missed before it (each step "not running"
 * was told at once, before the scheduler's next tick noted the switch).
 */
test("switching accounts while something runs: it carries on in its own account, the switch isn't refused", async () => {
  const { setAccountsInstalled, addAccount, withAccount, activeAccountId, setActiveAccount } = await import("@/db/accounts");
  const { switchAccount } = await import("@/lib/accounts");
  const { accountFlag, setAccountFlag } = await import("@/lib/sync/account-flags");
  setAccountsInstalled(true);
  const before = activeAccountId();
  const other = addAccount("Privat 2", "amber");
  // A briefing run and a mail sync going in the account you're in.
  setAccountFlag("__zeffBoardRun", { id: 3, phase: "ai" }, before);
  setAccountFlag("__zeffMailSyncing", true, before);
  try {
    switchAccount(other.id);
    assert.equal(activeAccountId(), other.id);
    // Still the first account's — not shown, nor refusing, in the one switched to.
    assert.deepEqual(accountFlag("__zeffBoardRun", before), { id: 3, phase: "ai" });
    assert.equal(withAccount(other.id, () => accountFlag("__zeffBoardRun")), undefined);
    assert.equal(withAccount(other.id, () => accountFlag("__zeffMailSyncing")), undefined);
  } finally {
    setAccountFlag("__zeffBoardRun", null, before);
    setAccountFlag("__zeffMailSyncing", null, before);
    setActiveAccount(before);
  }
});
