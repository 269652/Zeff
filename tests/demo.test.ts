import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * The demo: an account of its own, filled with sample mails, chats, people, appointments and the todos derived from them —
 * where nothing syncs and no action leaves (an action is taken off its todo as done, saying it wasn't really done); out of
 * it, back into your own account.
 */

test("the demo: its own account with sample todos that cite their messages; nothing syncs, nothing is sent", async () => {
  const accounts = await import("@/db/accounts");
  const demo = await import("@/lib/demo");
  const before = accounts.activeAccountId();
  const id = await demo.startDemo();
  assert.notEqual(id, before, "an account of its own");
  assert.equal(accounts.activeAccountId(), id, "switched to");
  assert.ok(accounts.isDemoAccount(id));
  assert.equal(accounts.isDemoAccount(before), false);
  // Again: the same demo, not a second one.
  assert.equal(await demo.startDemo(), id);
  assert.equal(accounts.listAccounts().filter((a) => a.demo).length, 1);

  await accounts.withAccount(id, async () => {
    const store = await import("@/lib/todos/store");
    const open = store.listTodos({ status: "open", byWorker: false }); // (yours — not the lesson's conversation todo of the Learn demo)
    assert.ok(open.length >= 5, `sample todos (${open.length})`);
    assert.ok(open.every((t) => t.refs.some((r) => r.startsWith("mail:"))), "each cites the message it came from");
    const { getDb, schema } = await import("@/db");
    const mails = getDb().select().from(schema.emails).all();
    assert.ok(mails.some((m) => m.folder === "WhatsApp") && mails.some((m) => m.folder === "Gmail"), "mails and chats");
    // An action runs — but only in words.
    const chat = open.find((t) => t.ops.some((o) => o.type === "whatsapp-message"))!;
    const { runTodoOpsNow } = await import("@/lib/ops");
    const r = await runTodoOpsNow(chat.id);
    assert.match(r.done.join(" "), /Demo/);
    assert.equal(store.getTodo(chat.id)!.ops.length, 0, "taken off the todo");
    // And nothing syncs.
    const { startSyncAll, runStoppable } = await import("@/lib/sync/registry");
    assert.equal((await startSyncAll()).ok, false);
    await assert.rejects(() => runStoppable("mail", async () => 1), /demo/i);
  });

  assert.equal(await demo.leaveDemo(), before, "back into your own");
  assert.equal(accounts.isDemoAccount(), false);
});
