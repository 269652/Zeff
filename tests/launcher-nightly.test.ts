import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

/** The launcher's nightly restart of Zeff's server (launcher/lib/nightly.js, CommonJS): when it restarts, waits or lets a night pass. */
const nightly = async () => {
  const m = await import("../launcher/lib/nightly.js");
  return (m.default ?? m) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const at = (s: string) => new Date(`${s}:00`); // local time
const MIN = 60_000;

test("on by default at 04:30: before it waits, after it restarts once Zeff has been idle 10 minutes", async () => {
  const { decide, DEFAULTS } = await nightly();
  assert.deepEqual(DEFAULTS, { enabled: true, at: "04:30" });
  const idle = at("2026-10-30T03:00").getTime();
  // Before 04:30: yesterday's night is long over (skipped — never a restart in the day), today's not yet due.
  assert.deepEqual(decide({ now: at("2026-10-30T04:29"), lastDay: "2026-10-29", lastActivity: idle }), { action: "done", day: "2026-10-29" });
  assert.deepEqual(decide({ now: at("2026-10-30T04:30"), lastDay: "2026-10-29", lastActivity: idle }), { action: "restart", day: "2026-10-30" });
  // Used 5 minutes ago: it waits; 10 minutes quiet: now.
  assert.equal(decide({ now: at("2026-10-30T04:35"), lastActivity: at("2026-10-30T04:30").getTime() }).action, "wait");
  assert.equal(decide({ now: at("2026-10-30T04:40"), lastActivity: at("2026-10-30T04:30").getTime() }).action, "restart");
  // Once a night: restarted (lastDay) — nothing more until the next 04:30.
  assert.equal(decide({ now: at("2026-10-30T05:00"), lastDay: "2026-10-30", lastActivity: idle }).action, "done");
  assert.equal(decide({ now: at("2026-10-31T04:31"), lastDay: "2026-10-30", lastActivity: idle }).action, "restart");
});

test("busy the whole window: that night is skipped, never a restart in the middle of the day", async () => {
  const { decide } = await nightly();
  const now = (s: string) => ({ now: at(s), lastActivity: at(s).getTime() - MIN });
  assert.equal(decide(now("2026-10-30T06:29")).action, "wait", "still inside the two hours after 04:30");
  assert.deepEqual(decide(now("2026-10-30T06:30")), { action: "skip", day: "2026-10-30" });
  // A launcher started at noon, Zeff idle since the morning: no restart now (the night is over).
  assert.equal(decide({ now: at("2026-10-30T12:00"), lastActivity: at("2026-10-30T07:00").getTime() }).action, "skip");
});

test("off, not running, another time, a time over midnight", async () => {
  const { decide } = await nightly();
  const old = 0;
  assert.deepEqual(decide({ now: at("2026-10-30T04:45"), enabled: false, lastActivity: old }), { action: "off" });
  assert.equal(decide({ now: at("2026-10-30T04:45"), running: false, lastActivity: old }).action, "wait", "a server not running (starting, crashed) isn't restarted");
  assert.equal(decide({ now: at("2026-10-30T02:00"), at: "02:00", lastActivity: old }).action, "restart");
  assert.equal(decide({ now: at("2026-10-30T04:45"), at: "nonsense", lastActivity: old }).action, "restart", "an unreadable time: 04:30");
  // 23:30, the window running over midnight: at 00:15 it still counts for the night that began the day before.
  assert.deepEqual(decide({ now: at("2026-10-31T00:15"), at: "23:30", lastActivity: old }), { action: "restart", day: "2026-10-30" });
  assert.equal(decide({ now: at("2026-10-31T00:15"), at: "23:30", lastDay: "2026-10-30", lastActivity: old }).action, "done");
});

test("what counts as using Zeff: pages and actions — not Next's files, not prefetches", async () => {
  const { isActivity } = await nightly();
  assert.equal(isActivity({ url: "/heute", headers: {} }), true);
  assert.equal(isActivity({ url: "/workspace/3", headers: { "next-action": "abc" } }), true);
  assert.equal(isActivity({ url: "/_next/static/chunks/a.js", headers: {} }), false);
  assert.equal(isActivity({ url: "/_next/webpack-hmr?id=1", headers: {} }), false);
  assert.equal(isActivity({ url: "/todos", headers: { "next-router-prefetch": "1" } }), false);
});

test("the setting is kept in the launcher's state folder; zeff-launcher.json gives the defaults", async () => {
  const { read, write } = await nightly();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nightly-"));
  try {
    assert.deepEqual(read(dir), { enabled: true, at: "04:30", lastDay: null });
    assert.deepEqual(read(dir, { nightlyRestart: false, nightlyRestartAt: "03:15" }), { enabled: false, at: "03:15", lastDay: null });
    write(dir, { enabled: false, at: "05:00", lastDay: "2026-10-30" });
    assert.deepEqual(read(dir, { nightlyRestart: true }), { enabled: false, at: "05:00", lastDay: "2026-10-30" }, "the tray switch wins over the config");
    fs.writeFileSync(path.join(dir, "nightly-restart.json"), "{ not json");
    assert.deepEqual(read(dir), { enabled: true, at: "04:30", lastDay: null });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
