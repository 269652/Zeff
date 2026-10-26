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

test("a tab that stays hung is closed and opened anew at its address — a non-web one only closed, one that won't close left", async () => {
  const { replaceTabs } = await import("../scripts/chrome-cdp.mjs");
  const closed: string[] = [];
  const opened: string[] = [];
  const left = await replaceTabs(
    "http://127.0.0.1:9222/",
    [
      { ...tab("punch"), url: "https://ac.punch24.example/punch/index.jsp" },
      { ...tab("newtab"), url: "chrome://newtab/" },
      { ...tab("stubborn"), url: "https://outlook.example/mail/" },
    ],
    {
      close: async (t: Tab) => {
        if (t.id === "stubborn") throw new Error("no answer");
        closed.push(t.id);
        return true;
      },
      open: async (url: string) => void opened.push(url),
    } as never,
  );
  assert.deepEqual(closed, ["punch", "newtab"]);
  assert.deepEqual(opened, ["https://ac.punch24.example/punch/index.jsp"]);
  assert.deepEqual(left.map((t: Tab) => t.id), ["stubborn"]);
});
