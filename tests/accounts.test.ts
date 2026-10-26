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
test("switching accounts: its sync runs count from the switch, nothing is overdue", async () => {
  const { setAccountsInstalled, addAccount, withAccount, activeAccountId, setActiveAccount } = await import("@/db/accounts");
  const { switchAccount } = await import("@/lib/accounts");
  const { getPref, setPref } = await import("@/lib/prefs");
  setAccountsInstalled(true);
  const before = activeAccountId();
  const other = addAccount("Privat", "amber");
  withAccount(other.id, () => setPref("sync-active-since", Date.parse("2026-10-01T08:00:00Z"))); // when it was last the one you were in

  const at = Date.now();
  switchAccount(other.id);
  try {
    assert.equal(activeAccountId(), other.id);
    assert.ok(withAccount(other.id, () => getPref<number>("sync-active-since", 0)) >= at);
  } finally {
    setActiveAccount(before);
  }
});
