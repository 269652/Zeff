import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { setupTempData } from "./helpers";

/**
 * A kind of chat that an external plugin brings (manifest `chats`): its rules are the plugin's file, its tools Zeff's, its todos found by the
 * plugin's own key, and — if it says so — its conversation kept in a database whose changes the next session is told about.
 */
setupTempData();
process.env.ZEFF_PLUGINS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-plugins-"));
after(() => fs.rmSync(process.env.ZEFF_PLUGINS_DIR!, { recursive: true, force: true }));

test("a plugin's chat: rules from its file, its tools added, one todo per key, the conversation in a database", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  await import("@/plugins/contributions");
  const { metaRun } = await import("@/plugins/workspace/meta");
  const { setEnabled } = await import("@/lib/ext/registry");
  const store = await import("@/plugins/workspace/store");

  const db = store.createPage({ kind: "database", title: "Talk" });
  store.updateSchema(db, {
    ...store.getDatabase(db)!.schema,
    properties: [
      { id: "text", name: "Text", type: "text" },
      { id: "topic", name: "Topic", type: "text" },
      { id: "role", name: "Role", type: "select", options: [{ id: "t", name: "teacher", color: "blue" }, { id: "y", name: "you", color: "gray" }, { id: "s", name: "system", color: "gray" }] },
    ],
  });
  metaRun("plugin.save", {
    id: "coach",
    manifest: {
      name: "Coach",
      apiVersion: 1,
      contributes: { chats: [{ id: "talk", title: "Talk", rules: "rules.md", tools: ["workspace_call_function"], conversation: { database: String(db), text: "Text", role: "Role", roles: { you: "you", agent: "teacher", system: "system" }, key: "Topic" } }] },
    },
    files: { "rules.md": "You coach about {{key}} for {{plugin}}. {{missing}}" },
  });
  const { extChat, ensureChatTodo, todoOfKey, keyOfTodo, extProfile } = await import("@/lib/work/ext-chat");
  assert.equal(extChat("coach.talk"), undefined, "a plugin that is off brings no chat");
  setEnabled("coach", true);
  const c = extChat("coach.talk")!;
  assert.ok(c);
  assert.equal(c.kind, "ext.coach.talk");

  const a = ensureChatTodo(c, "Sleep", "Coach: Sleep");
  assert.equal(ensureChatTodo(c, "Sleep", "again"), a, "one todo per key");
  assert.notEqual(ensureChatTodo(c, "Food", "Coach: Food"), a);
  assert.equal(todoOfKey("coach.talk", "Sleep"), a);
  assert.deepEqual(keyOfTodo(a), { chat: "coach.talk", key: "Sleep" });
  const { getTodo } = await import("@/lib/todos/store");
  assert.equal(getTodo(a)?.source, "Zeff-Chat:ext.coach.talk");
  assert.equal(getTodo(a)?.byWorker, true);

  // The profile: the plugin's rules with the key, the chat's own tools and the plugin's.
  const { chatProfileFor, CHAT_ALLOWED_TOOLS } = await import("@/lib/chat");
  const p = await chatProfileFor({ id: a, source: "Zeff-Chat:ext.coach.talk", text: "x" }, "PRE");
  assert.match(p.rules, /You coach about Sleep for coach\./);
  assert.match(p.rules, /PRE/);
  assert.ok(p.allowedTools.includes("mcp__zeff__workspace_call_function"));
  for (const t of CHAT_ALLOWED_TOOLS) assert.ok(p.allowedTools.includes(t));

  // The conversation database: its rows for the key, in order; a change made by someone is told to the next session.
  const conv = await import("@/plugins/workspace/chat-conversation");
  store.addRow(db, { title: "hi", cells: { text: "hi", topic: "Sleep", role: "y" } });
  store.addRow(db, { title: "hello", cells: { text: "Hello!", topic: "Sleep", role: "t" } });
  store.addRow(db, { title: "other", cells: { text: "other", topic: "Food", role: "y" } });
  assert.deepEqual(conv.messagesOf(a).map((m) => [m.role, m.text]), [["you", "hi"], ["agent", "Hello!"]]);
  const { freshContext, freshStarted } = await import("@/lib/work/conversation-guard");
  // (Looked at first: the state is "as left".)
  conv.syncChat(a);
  assert.equal(freshContext(a), null, "nothing changed since the session spoke");
  const row = store.rawRows(db).find((r) => r.title === "hello")!;
  store.setCell(row.id, "text", "Hello, changed by you");
  const fresh = freshContext(a);
  assert.ok(fresh && /Hello, changed by you/.test(fresh), "the stored conversation changed: a fresh session carries it");
  freshStarted(a);
  assert.equal(freshContext(a), null);
});

test("a manifest's chat is checked: the context function must exist, the rules file be there", async () => {
  const { metaRun } = await import("@/plugins/workspace/meta");
  assert.throws(() => metaRun("plugin.save", { id: "bad-chat", manifest: { name: "Bad", apiVersion: 1, contributes: { chats: [{ id: "a", rules: "r.md", context: "nope" }] } }, files: { "r.md": "x" } }), /no function "nope"/);
  assert.throws(() => metaRun("plugin.save", { id: "bad-chat2", manifest: { name: "Bad", apiVersion: 1, contributes: { chats: [{ id: "a", rules: "missing.md" }] } }, files: {} }), /missing\.md/);
});
