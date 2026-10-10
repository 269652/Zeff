import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const steps = [
  { key: "whatsapp" as const, label: "WhatsApp", href: "/apps/whatsapp", running: false },
  { key: "keep" as const, label: "Google Keep", href: "/keep", running: false },
  { key: "teams" as const, label: "Teams", href: "/teams", running: false },
];

/** A sync that keeps failing shows up (since its first failure, with its cause); once is a blip; a good run clears it. */
test("syncs that keep failing are problems, a blip isn't", async () => {
  const { noteSyncResult, syncProblems } = await import("@/lib/sync/health");
  const t0 = Date.parse("2026-10-10T08:00:00Z");
  const at = (h: number) => new Date(t0 + h * 3600e3).toISOString();

  noteSyncResult("whatsapp", true, "12 Chats", at(0));
  noteSyncResult("whatsapp", false, "locator('#side input') timed out", at(1));
  assert.deepEqual(syncProblems(steps, t0 + 2 * 3600e3), [], "failed once: a blip");

  noteSyncResult("whatsapp", false, "locator('#side input') timed out", at(2));
  const [p] = syncProblems(steps, t0 + 3 * 3600e3);
  assert.equal(p.key, "whatsapp");
  assert.equal(p.kind, "broken");
  assert.equal(p.failures, 2);
  assert.equal(p.since, at(1), "since the first failure");
  assert.equal(p.lastOkAt, at(0));

  // A daily step failing once, but for long: a problem too.
  noteSyncResult("keep", false, "Keep shows Google's sign-in — sign in in the automation Chrome, then try again.", at(0));
  assert.equal(syncProblems(steps, t0 + 13 * 3600e3).find((x) => x.key === "keep")?.kind, "login");

  noteSyncResult("teams", false, "The automation Chrome isn't running.", at(0));
  noteSyncResult("teams", false, "The automation Chrome isn't running.", at(1));
  assert.equal(syncProblems(steps, t0 + 2 * 3600e3).find((x) => x.key === "teams")?.kind, "chrome");

  // Running right now: not shown (its run may be fixing it).
  assert.equal(syncProblems([{ ...steps[0], running: true }], t0 + 3 * 3600e3).length, 0);

  noteSyncResult("whatsapp", true, "12 Chats", at(4));
  assert.equal(syncProblems(steps, t0 + 5 * 3600e3).find((x) => x.key === "whatsapp"), undefined, "a good run clears it");
});
