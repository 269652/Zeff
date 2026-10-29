import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

/**
 * Disposable test servers (scripts/test-server.mjs): a registry of what was started (pid, port, until when), and which
 * running `next` processes may be reaped — never the user's live server (9333), never one of the main checkout without the
 * test marker, never one that hasn't outlived its time.
 */
const lib = () => import("../scripts/test-servers-lib.mjs");

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zeff-reg-")), "servers.json");

test("the registry: missing or broken reads as empty; entries are added, replaced by pid and removed", async () => {
  const { readRegistry, addEntry, removeEntry } = await lib();
  const file = tmpFile();
  assert.deepEqual(readRegistry(file), []);
  fs.writeFileSync(file, "{not json");
  assert.deepEqual(readRegistry(file), [], "a broken file is an empty registry");
  const a = { pid: 10, port: 9500, url: "http://localhost:9500", dataDir: "x", startedAt: 1000, ttlMs: 60_000 };
  addEntry(file, a);
  addEntry(file, { ...a, pid: 11, port: 9501 });
  addEntry(file, { ...a, port: 9502 });
  assert.deepEqual(readRegistry(file).map((e: { pid: number; port: number }) => [e.pid, e.port]), [[11, 9501], [10, 9502]], "same pid: replaced");
  removeEntry(file, 11);
  assert.deepEqual(readRegistry(file).map((e: { pid: number }) => e.pid), [10]);
});

test("an entry is expired once its TTL has passed since it started", async () => {
  const { isExpired, expiresAt } = await lib();
  const e = { pid: 1, port: 1, startedAt: 1000, ttlMs: 500 };
  assert.equal(expiresAt(e), 1500);
  assert.equal(isExpired(e, 1499), false);
  assert.equal(isExpired(e, 1500), true);
});

const MAIN = "C:\\Users\\me\\Zeff";
const TMP = "C:\\Users\\me\\AppData\\Local\\Temp";
const WT = "C:\\Users\\me\\Zeff-e2e";
const MIN = 60_000;
const NOW = 100 * MIN;
const nextDev = (root: string, extra = "") => `"C:\\Program Files\\nodejs\\node.exe" ${extra}${root}\\node_modules\\next\\dist\\bin\\next dev -H 127.0.0.1 -p 9448`;
const startServer = (root: string) => `"C:\\Program Files\\nodejs\\node.exe" ${root}\\node_modules\\next\\dist\\server\\lib\\start-server.js`;
const opts = (registry: { pid: number; port: number; startedAt: number; ttlMs: number }[] = []) => ({ now: NOW, ttlMs: 30 * MIN, registry, mainCheckout: MAIN, worktrees: [WT], tmpDir: TMP, protectedPorts: [9333] });

test("reap: a registered server past its TTL goes, one within it stays; a pid reused by something else is left", async () => {
  const { reapPlan, MARKER } = await lib();
  const procs = [
    { pid: 1, ppid: 0, cmdline: nextDev(MAIN, `${MARKER} `), startedAt: NOW - 50 * MIN },
    { pid: 2, ppid: 1, cmdline: startServer(MAIN), startedAt: NOW - 50 * MIN, port: 9600 },
    { pid: 3, ppid: 0, cmdline: nextDev(MAIN, `${MARKER} `), startedAt: NOW - 5 * MIN },
    { pid: 4, ppid: 0, cmdline: "notepad.exe", startedAt: NOW - 90 * MIN },
  ];
  const registry = [
    { pid: 1, port: 9600, startedAt: NOW - 50 * MIN, ttlMs: 30 * MIN },
    { pid: 3, port: 9601, startedAt: NOW - 5 * MIN, ttlMs: 30 * MIN },
    { pid: 4, port: 9602, startedAt: NOW - 90 * MIN, ttlMs: 30 * MIN },
  ];
  const plan = reapPlan(procs, opts(registry));
  assert.deepEqual(plan.map((p: { pid: number }) => p.pid), [1], "only the expired one — its child goes with its tree");
});

test("reap: an unregistered next dev of a worktree or a temp folder older than the TTL goes; the main checkout's and young ones stay", async () => {
  const { reapPlan } = await lib();
  const procs = [
    { pid: 10, ppid: 0, cmdline: nextDev(WT), startedAt: NOW - 40 * MIN },
    { pid: 11, ppid: 10, cmdline: startServer(WT), startedAt: NOW - 40 * MIN, port: 9448 },
    { pid: 12, ppid: 0, cmdline: nextDev(`${TMP}\\claude\\x\\scratchpad\\wt`), startedAt: NOW - 40 * MIN },
    { pid: 13, ppid: 0, cmdline: nextDev(MAIN), startedAt: NOW - 400 * MIN },
    { pid: 14, ppid: 0, cmdline: nextDev(WT), startedAt: NOW - 10 * MIN },
    { pid: 15, ppid: 0, cmdline: nextDev("C:\\Users\\me\\Other"), startedAt: NOW - 400 * MIN },
    { pid: 16, ppid: 999, cmdline: startServer(WT), startedAt: NOW - 40 * MIN },
  ];
  const plan = reapPlan(procs, opts());
  assert.deepEqual(plan.map((p: { pid: number }) => p.pid).sort(), [10, 12, 16], "worktree + temp folder + an orphaned child; not main, not young, not unknown");
});

test("reap: never anything on a protected port, nor its parents or children — even marked and expired", async () => {
  const { reapPlan, MARKER } = await lib();
  const procs = [
    { pid: 20, ppid: 0, cmdline: nextDev(WT, `${MARKER} `), startedAt: NOW - 400 * MIN },
    { pid: 21, ppid: 20, cmdline: startServer(WT), startedAt: NOW - 400 * MIN, port: 9333 },
    { pid: 22, ppid: 21, cmdline: nextDev(WT), startedAt: NOW - 400 * MIN },
  ];
  assert.deepEqual(reapPlan(procs, opts([{ pid: 20, port: 9333, startedAt: 0, ttlMs: 1 }])), []);
});

test("reap: an unregistered marked server past the default TTL goes, wherever it runs", async () => {
  const { reapPlan, MARKER } = await lib();
  const procs = [
    { pid: 30, ppid: 0, cmdline: nextDev(MAIN, `${MARKER} `), startedAt: NOW - 40 * MIN },
    { pid: 31, ppid: 0, cmdline: nextDev(MAIN, `${MARKER} `), startedAt: NOW - 20 * MIN },
  ];
  const plan = reapPlan(procs, opts());
  assert.deepEqual(plan.map((p: { pid: number }) => p.pid), [30]);
  assert.match(plan[0].reason, /marked/);
});

test("reap: a worktree inside the main checkout (.claude/worktrees) counts as a worktree", async () => {
  const { reapPlan } = await lib();
  const inner = `${MAIN}\\.claude\\worktrees\\x`;
  const procs = [{ pid: 40, ppid: 0, cmdline: nextDev(inner), startedAt: NOW - 40 * MIN }];
  assert.deepEqual(reapPlan(procs, { ...opts(), worktrees: [MAIN, inner] }).map((p: { pid: number }) => p.pid), [40]);
});

test("the checkout a next command line runs from: the folder above node_modules, quoted or not, either slash", async () => {
  const { checkoutOf } = await lib();
  assert.equal(checkoutOf(nextDev(WT)), WT);
  assert.equal(checkoutOf(`node "C:/Users/me/My Zeff/node_modules/next/dist/bin/next" dev`), "C:/Users/me/My Zeff");
  assert.equal(checkoutOf("notepad.exe"), null);
});
