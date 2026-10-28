import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

// Accounts side by side, each at its own address: the request's host names the account (any number of them — "privat.localhost",
// "business.localhost", even "localhost" for one); a run's id is its account's, so runs kept in memory are per account.
setupTempData();

test("each account at its own host — three of them, any of them on localhost; case, port and a forged name don't matter", async () => {
  const { addAccount, setAccountsInstalled, updateAccount, DEFAULT_ACCOUNT } = await import("@/db/accounts");
  const { accountForHost, hostnameOf } = await import("@/lib/lock/shared");
  setAccountsInstalled(true);
  const privat = addAccount("Privat", "emerald");
  const verein = addAccount("Verein", "amber");
  assert.equal(accountForHost("privat.localhost:9333"), null, "no address set yet: the active one serves it");

  updateAccount(DEFAULT_ACCOUNT, { host: "business.localhost" });
  updateAccount(privat.id, { host: "LOCALHOST" });
  updateAccount(verein.id, { host: "http://verein.localhost:9333/" });
  await new Promise((r) => setTimeout(r, 1100)); // the proxy's short cache
  assert.equal(accountForHost("business.localhost:9333"), DEFAULT_ACCOUNT);
  assert.equal(accountForHost("localhost:9333"), privat.id);
  assert.equal(accountForHost("Verein.Localhost"), verein.id);
  assert.equal(accountForHost("127.0.0.1:9333"), null);
  assert.equal(hostnameOf("[::1]:9333"), "::1");

  assert.throws(() => updateAccount(verein.id, { host: "business.localhost" }), /address of another account/);
  assert.throws(() => updateAccount(verein.id, { host: "nicht gültig!" }), /isn't a host name/);
  // Empty: no address of its own any more.
  assert.equal(updateAccount(verein.id, { host: "" }).host, undefined);
  // The only one without an address: every address no account claims is its (not the one switched to).
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(accountForHost("127.0.0.1:9333"), verein.id);
  assert.equal(accountForHost("localhost:9333"), privat.id, "a claimed address stays its account's");
});

test("runs in memory per account: the same run id in two accounts is two runs; an earlier map's runs are taken over", async () => {
  const { RunMap } = await import("@/lib/work/run-map");
  const { withAccount } = await import("@/db/accounts");
  const earlier = new Map<number, { account?: string; name: string }>([[5, { account: "default", name: "old" }]]);
  const { currentAccountId } = await import("@/db/accounts");
  const runs = new RunMap(currentAccountId, earlier);
  runs.set(5, { account: "privat", name: "privat's #5" });
  assert.equal(withAccount("default", () => runs.get(5)?.name), "old");
  assert.equal(withAccount("privat", () => runs.get(5)?.name), "privat's #5");
  assert.deepEqual(withAccount("privat", () => [...runs.keys()]), [5]);
  assert.equal(runs.size, 2);
  withAccount("privat", () => runs.delete(5));
  assert.equal(withAccount("default", () => runs.get(5)?.name), "old", "deleting privat's #5 left default's");
  assert.equal([...runs.values()].length, 1);
});
