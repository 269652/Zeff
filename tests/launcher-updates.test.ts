import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

/** The launcher's updates (launcher/lib/updates.js, CommonJS): how it finds one, a checkout fast-forwarded, a bundle swapped. */
const updates = async () => {
  const m = await import("../launcher/lib/updates.js");
  return (m.default ?? m) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd, encoding: "utf8" }).trim();
const write = (f: string, s: string) => (fs.mkdirSync(path.dirname(f), { recursive: true }), fs.writeFileSync(f, s));

test("versions: a newer release is told by its numbers, not as text", async () => {
  const u = await updates();
  assert.equal(u.isNewer("v0.1.10", "0.1.9"), true);
  assert.equal(u.isNewer("v0.1.5", "0.1.5"), false);
  assert.equal(u.isNewer("v0.1.4", "0.1.5"), false);
  assert.equal(u.isNewer("v1.0.0", "0.9.9"), true);
  assert.equal(u.isNewer("nightly", "0.1.5"), false, "unreadable: no");
});

test("the release archive for this system, as dist.mjs names it — none for macOS", async () => {
  const u = await updates();
  assert.equal(u.assetName("v0.1.6", "win32", "x64"), "Zeff-v0.1.6-windows-x64.zip");
  assert.equal(u.assetName("v0.1.6", "linux", "x64"), "Zeff-v0.1.6-linux-x64.tar.gz");
  assert.equal(u.assetName("v0.1.6", "darwin", "arm64"), null);
});

test("how Zeff is installed: a checkout (git), the bundle's app/ (release), or neither", async () => {
  const u = await updates();
  const dir = tmp("zeff-kind-");
  write(path.join(dir, "app", "package.json"), "{}");
  assert.equal(u.installKind({ app: path.join(dir, "app"), bundleDir: dir }, "win32"), "release");
  assert.equal(u.installKind({ app: path.join(dir, "app"), bundleDir: dir }, "darwin"), "none");
  fs.mkdirSync(path.join(dir, "app", ".git"));
  assert.equal(u.installKind({ app: path.join(dir, "app"), bundleDir: dir }, "win32"), "git");
});

test("a checkout: offered only when it is just behind its upstream; not without one, not when it went its own way; held by local changes", async () => {
  const u = await updates();
  const root = tmp("zeff-git-");
  const origin = path.join(root, "origin");
  fs.mkdirSync(origin);
  git(origin, "init", "-q", "-b", "main");
  write(path.join(origin, "package.json"), JSON.stringify({ name: "zeff", version: "0.1.0" }));
  git(origin, "add", ".");
  git(origin, "commit", "-qm", "one");
  const app = path.join(root, "app");
  git(root, "clone", "-q", origin, app);

  let r = await u.check({ app, bundleDir: root, repo: "x/y" });
  assert.equal(r.kind, "git");
  assert.equal(r.available, false, "up to date");

  write(path.join(origin, "README.md"), "new");
  git(origin, "add", ".");
  git(origin, "commit", "-qm", "two");
  r = await u.check({ app, bundleDir: root, repo: "x/y" });
  assert.equal(r.available, true, JSON.stringify(r));
  assert.equal(r.behind, 1);
  assert.equal(r.blocked ?? null, null);

  // Changed by hand: offered, but held.
  write(path.join(app, "package.json"), JSON.stringify({ name: "zeff", version: "0.1.0", x: 1 }));
  r = await u.check({ app, bundleDir: root, repo: "x/y" });
  assert.ok(r.blocked, "local changes hold it");
  git(app, "checkout", "--", "package.json");

  // The update: fast-forwarded, nothing of the launcher's changed.
  const done = await u.updateGit(app);
  assert.equal(done.files, 1);
  assert.equal(done.launcher, false);
  assert.ok(fs.existsSync(path.join(app, "README.md")));
  r = await u.check({ app, bundleDir: root, repo: "x/y" });
  assert.equal(r.available, false);

  // Its own commit and a new one upstream: went apart — never merged by itself.
  write(path.join(app, "mine.txt"), "mine");
  git(app, "add", ".");
  git(app, "commit", "-qm", "mine");
  write(path.join(origin, "theirs.txt"), "theirs");
  git(origin, "add", ".");
  git(origin, "commit", "-qm", "theirs");
  r = await u.check({ app, bundleDir: root, repo: "x/y" });
  assert.equal(r.available, false);
  assert.match(r.note, /went apart/);

  // A branch without an upstream (like a checkout of your own): nothing to look for.
  git(app, "checkout", "-qb", "local");
  r = await u.check({ app, bundleDir: root, repo: "x/y" });
  assert.equal(r.available, false);
  assert.match(r.note, /follows no remote branch/);
});

test("the bundle swapped by the script: the new app/ and launcher in, app/data and app/.env kept, the old app/ aside", async () => {
  const u = await updates();
  const bundle = tmp("zeff-bundle-");
  write(path.join(bundle, "app", "package.json"), JSON.stringify({ name: "zeff", version: "0.1.5" }));
  write(path.join(bundle, "app", "old-only.js"), "old");
  write(path.join(bundle, "app", "data", "zeff.db"), "my data");
  write(path.join(bundle, "app", ".env"), "X=1");
  write(path.join(bundle, "Zeff.exe"), "old launcher");
  const fresh = path.join(bundle, ".update", "unpacked", "Zeff");
  write(path.join(fresh, "app", "package.json"), JSON.stringify({ name: "zeff", version: "0.1.6" }));
  write(path.join(fresh, "Zeff.exe"), "new launcher");
  write(path.join(fresh, "runtime", "node.exe"), "node");
  const log = path.join(bundle, "update.log");
  const win = process.platform === "win32";
  const script = path.join(bundle, ".update", win ? "swap.ps1" : "swap.sh");
  // A process long gone; a restart that does nothing.
  fs.writeFileSync(script, u.swapScript({ pid: 999999, bundleDir: bundle, newBundle: fresh, restart: win ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "whoami.exe") : "true", logFile: log }));
  if (win) execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], { stdio: "ignore", timeout: 120000 });
  else execFileSync("/bin/sh", [script], { stdio: "ignore", timeout: 120000 });

  assert.match(fs.readFileSync(log, "utf8"), /updated/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(bundle, "app", "package.json"), "utf8")).version, "0.1.6");
  assert.equal(fs.readFileSync(path.join(bundle, "app", "data", "zeff.db"), "utf8"), "my data", "the data kept");
  assert.equal(fs.readFileSync(path.join(bundle, "app", ".env"), "utf8"), "X=1");
  assert.ok(!fs.existsSync(path.join(bundle, "app", "old-only.js")), "the old app's files gone with it");
  assert.equal(fs.readFileSync(path.join(bundle, "Zeff.exe"), "utf8"), "new launcher");
  assert.ok(fs.existsSync(path.join(bundle, "runtime", "node.exe")));
  // What's left behind goes at the next start.
  u.cleanUp({ bundleDir: bundle });
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(!fs.existsSync(path.join(bundle, "app.old")));
  assert.ok(!fs.existsSync(path.join(bundle, ".update")));
});
