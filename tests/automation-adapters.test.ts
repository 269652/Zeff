import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

/* eslint-disable @typescript-eslint/no-explicit-any */

// The defaults of the contracts, never the user's override file.
process.env.ZEFF_AUTOMATION_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-adapters-"));
process.on("exit", () => fs.rmSync(process.env.ZEFF_AUTOMATION_DIR!, { recursive: true, force: true }));

/** The adapters' in-page functions run here against a fake page: the probe installed on `g`, which is also `window`. */
async function page(g: any): Promise<void> {
  const { installProbe } = await import("../scripts/automation/probe.mjs");
  g.window = g;
  (globalThis as any).window = g;
  (globalThis as any).document = g.document;
  installProbe(g, "test");
}
const dom = (selectors: Record<string, number>, text = "") => ({
  querySelector: (q: string) => (q.split(",").some((s) => (selectors[s.trim()] ?? 0) > 0) ? { tag: q } : null),
  querySelectorAll: (q: string) => Array.from({ length: selectors[q.trim()] ?? 0 }, () => ({ tag: q })),
  body: { innerText: text },
  documentElement: { lang: "de" },
});
function registry(modules: Record<string, any>) {
  const modulesMap = Object.fromEntries(Object.entries(modules).map(([n, m]) => [n, { exports: { default: m }, defaultExport: m }]));
  return (name: string) => {
    if (name === "__debug") return { modulesMap };
    if (!(name in modules)) throw new Error(`Requiring unknown module "${name}"`);
    return modules[name];
  };
}

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------

const NOW = Math.floor(Date.now() / 1000);
const wmsg = (id: string, t: number, body: string, fromMe = false) => ({ id: { _serialized: id, fromMe }, t, type: "chat", body });
function whatsappModules(loaderName = "WAWebChatLoadMessages") {
  const msgs = [wmsg("m1", NOW - 100, "Hallo", true), wmsg("m2", NOW - 50, "Kannst du morgen?")];
  const chat = { id: { _serialized: "1@c.us", user: "1" }, t: NOW, formattedTitle: "Anna", unreadCount: 1, archive: false, msgs: { getModelsArray: () => msgs } };
  return {
    WAWebCollections: { Chat: { getModelsArray: () => [chat] }, Msg: {} },
    [loaderName]: { loadEarlierMsgs: async () => {}, loadRecentMsgs: async () => {} },
    WAWebUserPrefsMeUser: { isMeAccount: () => false },
  } as Record<string, any>;
}

test("WhatsApp adapter: reads the messages of the active chats", async () => {
  const a = await import("../src/plugins/whatsapp/adapter.mjs");
  await page({ require: registry(whatsappModules()), document: dom({}) });
  const got: any = await a.readMessages({ contract: a.contract(), since: NOW - 3600, maxLoads: 2, maxMessages: 100 });
  assert.equal(got.chats, 1);
  assert.deepEqual(
    got.messages.map((m: any) => [m.id, m.from, m.text, m.unread]),
    [
      ["m2", "Anna", "Kannst du morgen?", true],
      ["m1", "Ich", "Hallo", false],
    ],
  );
});

test("WhatsApp adapter: the message loader renamed by an update is still found (by what it can do)", async () => {
  const a = await import("../src/plugins/whatsapp/adapter.mjs");
  await page({ require: registry(whatsappModules("WAWebChatLoadMessagesV3")), document: dom({}) });
  const got: any = await a.readMessages({ contract: a.contract(), since: NOW - 3600, maxLoads: 2, maxMessages: 100 });
  assert.equal(got.messages.length, 2);
  // … and the self-check tells that the contract wants an update.
  const checks: any[] = a.selfCheck({ contract: a.contract() });
  const load = checks.find((c) => c.kind === "module" && c.id === "load");
  assert.equal(load.level, "drift");
  assert.match(load.detail, /WAWebChatLoadMessagesV3/);
});

test("WhatsApp adapter: the loader gone — no-internals, saying which part", async () => {
  const a = await import("../src/plugins/whatsapp/adapter.mjs");
  const mods = whatsappModules();
  delete mods.WAWebChatLoadMessages;
  await page({ require: registry(mods), document: dom({}) });
  const got: any = await a.readMessages({ contract: a.contract(), since: NOW - 3600, maxLoads: 2, maxMessages: 100 });
  assert.deepEqual({ error: got.error, missing: got.missing }, { error: "no-internals", missing: ["load"] });
  const checks: any[] = a.selfCheck({ contract: a.contract() });
  assert.equal(checks.find((c) => c.kind === "module" && c.id === "load").level, "fail");
});

test("WhatsApp adapter: one chat's history, found by name; absence is told", async () => {
  const a = await import("../src/plugins/whatsapp/adapter.mjs");
  const mods = whatsappModules();
  mods.WAWebCollections.Chat.getModelsArray().forEach((c: any) => (c.msgs.msgLoadState = { noEarlierMsgs: true }));
  await page({ require: registry(mods), document: dom({}) });
  const got: any = await a.readHistory({ contract: a.contract(), name: "anna", maxLoads: 5, settleMs: 0 });
  assert.deepEqual({ chat: got.chat, n: got.messages.length, complete: got.complete }, { chat: "Anna", n: 2, complete: true });
  assert.equal(((await a.readHistory({ contract: a.contract(), name: "Zora", maxLoads: 1, settleMs: 0 })) as any).error, "not-found");
});

test("WhatsApp adapter: what the tab shows — chats, QR code, another window, loading", async () => {
  const a = await import("../src/plugins/whatsapp/adapter.mjs");
  const state = async (selectors: Record<string, number>, text = "") => {
    await page({ document: dom(selectors, text) });
    return a.readState({ contract: a.contract() });
  };
  assert.equal(await state({ "#pane-side": 1 }), "chats");
  assert.equal(await state({}, "Scanne den QR-Code mit deinem Telefon"), "link");
  assert.equal(await state({ 'canvas[aria-label*="QR" i]': 1 }), "link");
  assert.equal(await state({}, "WhatsApp ist in einem anderen Fenster geöffnet. Hier verwenden"), "elsewhere");
  assert.equal(await state({}, ""), "loading");
});

test("WhatsApp adapter: the self-check also looks at the shape of the live data (types only)", async () => {
  const a = await import("../src/plugins/whatsapp/adapter.mjs");
  const mods = whatsappModules();
  await page({ require: registry(mods), document: dom({ "#pane-side": 1, '[role="row"]': 3, "span[title]": 3, '#side input[data-tab="3"]': 1 }) });
  let checks: any[] = a.selfCheck({ contract: a.contract() });
  const byId = (id: string) => checks.find((c) => c.id === id);
  assert.equal(byId("chats").level, "ok");
  assert.equal(byId("chat-fields").level, "ok");
  assert.equal(byId("message-fields").level, "ok");
  assert.equal(byId("message-id"), undefined); // _serialized is there in this fake

  // A message whose id lost _serialized: told, but not a failure (the reader keys it chat|time).
  const chat = mods.WAWebCollections.Chat.getModelsArray()[0];
  const plain: any = { id: { fromMe: false }, t: NOW, type: "chat", body: "x" };
  chat.msgs.getModelsArray = () => [plain];
  checks = a.selfCheck({ contract: a.contract() });
  assert.equal(byId("message-id").level, "warn");
  assert.equal(byId("message-fields").level, "ok");

  // The field the reader needs for what kind of message it is is gone: a failure.
  delete plain.type;
  checks = a.selfCheck({ contract: a.contract() });
  assert.equal(byId("message-fields").level, "fail");
  assert.match(byId("message-fields").detail, /type:string/);
});

// ---------------------------------------------------------------------------
// Signal
// ---------------------------------------------------------------------------

function signalApp({ nav = true }: { nav?: boolean } = {}) {
  const state: any = {
    app: { appView: "Inbox", hasInitialLoadCompleted: true },
    conversations: { messagesByConversation: {}, messagesLookup: {} },
    ...(nav ? { nav: { selectedLocation: { details: { conversationId: "none" } } } } : {}),
  };
  const model = (id: string, attrs: Record<string, any>, loaders: any = {}) => ({
    id,
    get: (k: string) => attrs[k],
    getTitle: () => attrs.name,
    isBlocked: () => false,
    loadNewestMessages: async () => {},
    loadOlderMessages: async () => {},
    ...loaders,
  });
  const T = Date.now();
  const anna = model("c1", { type: "private", name: "Anna", timestamp: T, active_at: T, unreadCount: 1, lastMessage: "Hi", isArchived: false, serviceId: "s1" }, {
    loadNewestMessages: async () => {
      state.conversations.messagesByConversation.c1 = { messageIds: ["m1", "m2"] };
    },
  });
  const me = model("me", { type: "private", name: "Ich", serviceId: "s0" });
  const all = [me, anna];
  state.conversations.messagesLookup = {
    m1: { id: "m1", type: "outgoing", sent_at: T - 2000, body: "Hallo" },
    m2: { id: "m2", type: "incoming", sent_at: T - 1000, body: "Kannst du morgen?", readStatus: 1, sourceServiceId: "s1" },
  };
  const CC = { getAll: () => all, get: (id: string) => all.find((c) => c.id === id || c.get("serviceId") === id), getOurConversationId: () => "me" };
  return { state, all, g: { ConversationController: CC, reduxStore: { getState: () => state }, reduxActions: { conversations: { showConversation: () => {} } }, document: dom({}) } as any };
}

test("Signal adapter: reads the messages of the active chats", async () => {
  const a = await import("../src/plugins/signal/adapter.mjs");
  const { g } = signalApp();
  await page(g);
  const got: any = await a.readMessages({ contract: a.contract(), since: Date.now() - 3600e3, maxLoads: 1, maxMessages: 100 });
  assert.deepEqual(
    got.messages.map((m: any) => [m.id, m.from, m.text, m.unread]),
    [
      ["m2", "Anna", "Kannst du morgen?", true],
      ["m1", "Ich", "Hallo", false],
    ],
  );
});

test("Signal adapter: the open chat is found at either place (Signal 8: nav; older: conversations) — and left alone", async () => {
  const a = await import("../src/plugins/signal/adapter.mjs");
  const read = async () => ((await a.readMessages({ contract: a.contract(), since: 0, maxLoads: 1, maxMessages: 100 })) as any).messages.length;
  // Signal 8: open in the navigation state → not loaded by us (its view would jump), read as is: nothing loaded, nothing to read.
  const open = signalApp();
  open.state.nav.selectedLocation.details.conversationId = "c1";
  await page(open.g);
  assert.equal(await read(), 0);
  // Older Signal: the same in conversations.selectedConversationId.
  const old = signalApp({ nav: false });
  old.state.conversations.selectedConversationId = "c1";
  await page(old.g);
  assert.equal(await read(), 0);
  // Not open: loaded and read.
  const closed = signalApp();
  await page(closed.g);
  assert.equal(await read(), 2);
});

test("Signal adapter: what the app shows — chats, link, loading", async () => {
  const a = await import("../src/plugins/signal/adapter.mjs");
  const state = async (mut: (s: any) => void) => {
    const { g, state } = signalApp();
    mut(state);
    await page(g);
    return a.readState({ contract: a.contract() });
  };
  assert.equal(await state(() => {}), "chats");
  assert.equal(await state((s) => (s.app.appView = "Installer")), "link");
  assert.equal(await state((s) => (s.app.hasInitialLoadCompleted = false)), "loading");
  await page({ document: dom({}) });
  assert.equal(a.readState({ contract: a.contract() }), "loading");
});

test("Signal adapter: the self-check says what an update broke", async () => {
  const a = await import("../src/plugins/signal/adapter.mjs");
  const good = signalApp();
  await page(good.g);
  let checks: any[] = a.selfCheck({ contract: a.contract() });
  assert.deepEqual(checks.filter((c) => c.level === "fail" || c.level === "drift"), []);
  assert.equal(checks.find((c) => c.id === "chat-methods").level, "ok");

  // The store renamed: both the global and the state it gives are gone.
  const renamed = signalApp();
  renamed.g.reduxStoreV2 = renamed.g.reduxStore;
  delete renamed.g.reduxStore;
  await page(renamed.g);
  checks = a.selfCheck({ contract: a.contract() });
  assert.equal(checks.find((c) => c.kind === "global" && c.id === "store").level, "fail");
  assert.equal(checks.find((c) => c.kind === "state" && c.id === "redux").level, "fail");

  // A chat loses its loader: told by name.
  const noLoader = signalApp();
  delete (noLoader.all[0] as any).loadOlderMessages;
  await page(noLoader.g);
  checks = a.selfCheck({ contract: a.contract() });
  assert.match(checks.find((c) => c.id === "chat-methods").detail, /loadOlderMessages/);
});
