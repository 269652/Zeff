import assert from "node:assert/strict";
import test from "node:test";
import { installPlan, installStates, installsSettled, startInstall } from "@/lib/prerequisites-install";

test("Windows installs Chrome, Git, uv and Poppler with winget — silently, accepting the agreements; the AI CLIs aren't installed", () => {
  const has = (c: string) => c === "winget";
  for (const [id, wid] of [["browser", "Google.Chrome"], ["git", "Git.Git"], ["uv", "astral-sh.uv"], ["poppler", "oschwartz10612.Poppler"]] as const) {
    const p = installPlan(id, "win32", has)!;
    assert.equal(p.command, "winget");
    assert.ok(p.args.includes(wid) && p.args.includes("--silent") && p.args.includes("--accept-package-agreements"), id);
  }
  assert.equal(installPlan("claude", "win32", has), null);
  assert.equal(installPlan("git", "win32", () => false), null, "no winget: nothing to run");
  assert.equal(installPlan("git", "linux", () => true), null);
  assert.equal(installPlan("browser", "darwin", (c) => c === "brew")!.args.join(" "), "install --cask google-chrome");
});

test("an install runs in the background, one at a time; done when the program is found afterwards, failed with the output when not", async () => {
  const order: string[] = [];
  let found = false;
  const plan = { name: "winget", command: "winget", args: [] };
  const a = startInstall("git", { plan, found: () => found, run: async () => (order.push("git"), (found = true), { ok: true, out: "" }) });
  assert.equal(a.state, "running");
  assert.equal(startInstall("git", { plan, found: () => true, run: async () => ({ ok: true, out: "" }) }).state, "running", "not started twice");
  startInstall("uv", { plan, found: () => false, run: async () => (order.push("uv"), { ok: false, out: "no   network" }) });
  await installsSettled();
  assert.deepEqual(order, ["git", "uv"]);
  const s = Object.fromEntries(installStates().map((x) => [x.id, x]));
  assert.equal(s.git.state, "done");
  assert.equal(s.uv.state, "failed");
  assert.match(s.uv.out, /no network/);
  assert.equal(startInstall("poppler", { plan: null, found: () => false }).state, "failed");
});
