import assert from "node:assert/strict";
import test from "node:test";

type Tab = { id: string; webSocketDebuggerUrl: string };
const tab = (id: string): Tab => ({ id, webSocketDebuggerUrl: `ws://x/${id}` });

test("a tab Chrome froze answers again once it is brought to the front — only the ones that stay silent are reported", async () => {
  const { wakeTabs } = await import("../scripts/chrome-cdp.mjs");
  const awake = new Set<string>();
  const activated: string[] = [];
  const stuck = await wakeTabs("http://127.0.0.1:9222/", [tab("frozen"), tab("hung")], {
    activate: async (t: Tab) => {
      activated.push(t.id);
      if (t.id === "frozen") awake.add(t.id);
    },
    ping: async (url: string) => awake.has(url.split("/").pop()!),
  } as never);
  assert.deepEqual(activated, ["frozen", "hung"]);
  assert.deepEqual(stuck.map((t: Tab) => t.id), ["hung"]);
});

test("a tab that can't be activated is asked anyway; nothing stuck: nothing reported", async () => {
  const { wakeTabs } = await import("../scripts/chrome-cdp.mjs");
  const none = await wakeTabs("http://127.0.0.1:9222", [tab("a")], { activate: async () => { throw new Error("refused"); }, ping: async () => true } as never);
  assert.deepEqual(none, []);
  assert.deepEqual(await wakeTabs("http://127.0.0.1:9222", [], { activate: async () => {}, ping: async () => false } as never), []);
});
