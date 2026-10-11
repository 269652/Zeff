import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

// Live sessions of any provider go through its driver (src/lib/work/live-driver.ts): a stand-in
// driver registered is found by its runs, shown, counted idle — next to Claude Code's own.
setupTempData();

test("drivers: Claude's is there; another registers, and its runs are found through it", async () => {
  const { liveDriverFor, liveDriverOf, liveDrivers, liveIdle, liveSessionView, registerLiveDriver } = await import("@/lib/work/live-driver");
  assert.ok(liveDriverFor("claude"), "Claude Code's driver");
  assert.ok(liveDriverFor("claude")!.modes({ allowBypass: false }).every((m) => m.id !== "bypassPermissions"), "Bypass only when allowed");

  const mine = new Set([9001]);
  registerLiveDriver({
    provider: "stand-in",
    modes: () => [{ id: "ask", label: "Ask", hint: "asks" }],
    start: async () => {},
    reattach: () => {},
    has: (id) => mine.has(id),
    runIds: () => [...mine],
    view: (id) =>
      mine.has(id)
        ? {
            live: { mode: "ask", modes: [], busy: false, permission: null, waiting: "" },
            session: { provider: "stand-in", modes: [{ id: "ask", label: "Ask", hint: "asks" }], features: [], sessionId: null, model: null, models: [], effort: "", elevated: false, commands: [], host: "up", conversation: true, asks: [], queued: 0, costUsd: null, shellPending: 0, allowBypass: false },
          }
        : undefined,
    idle: (id) => mine.has(id),
    send: async () => {},
    answer: async () => {},
    interrupt: async () => {},
    setMode: async () => {},
    setModel: async () => {},
    finish: async () => {},
    close: async () => {},
    kill: () => {},
    outcome: () => ({ result: null, closed: true, lastText: "", costUsd: null, turns: 0, denials: 0, sessionId: null }),
  });
  assert.ok(liveDrivers().some((d) => d.provider === "stand-in"));
  assert.equal(liveDriverOf(9001)?.provider, "stand-in");
  assert.equal(liveSessionView(9001)?.session.costUsd, null, "a cost not known");
  assert.equal(liveIdle(9001), true);
  assert.equal(liveDriverOf(9002), undefined);
});
