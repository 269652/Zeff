import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { setupTempData } from "./helpers";

const dir = setupTempData();
fs.mkdirSync(path.join(dir, "accounts", "privat"), { recursive: true });
fs.writeFileSync(
  path.join(dir, "accounts.json"),
  JSON.stringify({
    active: "default",
    installed: true,
    accounts: [
      { id: "default", name: "Standard", color: "indigo", createdAt: "1970-01-01T00:00:00.000Z" },
      { id: "privat", name: "Privat", color: "emerald", createdAt: "2026-10-09T00:00:00.000Z", chromePort: 9231, knowledgePort: 9556 },
    ],
  }),
);

/** Background work started in one account stays there when you switch to another meanwhile. */
test("work started in the background stays in its account across a switch", async () => {
  const { inThisAccount, setActiveAccount, withAccount } = await import("@/db/accounts");
  const { createJob, listJobs } = await import("@/lib/jobs");
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  // Started in "Standard", it writes after a while…
  const work = inThisAccount(async () => {
    await gate;
    createJob({ number: "100001", name: "Aus dem Hintergrund" });
  });
  // …while you switch to "Privat".
  setActiveAccount("privat");
  release();
  await work;
  assert.deepEqual(withAccount("default", () => listJobs().map((j) => j.number)), ["100001"]);
  assert.deepEqual(withAccount("privat", () => listJobs().map((j) => j.number)), []);
});
