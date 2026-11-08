#!/usr/bin/env node
/**
 * The phone's own Zeff server, brought up to date: `npm run phone:deploy` (`--no-build`: swap in what .next-build holds).
 *
 * The phone (app.getzeff.com, through the launcher's companion) is served by a production build — fast — while Zeff's
 * server here stays `next dev` for you. That build lives in a git worktree beside the checkout, "<checkout>-phone",
 * detached at the commit it was built from; its data/ and node_modules are junctions to the checkout's (and .env a hard
 * link), so it is the same Zeff with the same data. The launcher runs it as the "Phone" service (port phonePort, 9337),
 * handing the syncs and runs to Zeff's server.
 *
 *   1. the worktree to master's newest commit (only committed code — what other sessions have in progress stays out)
 *   2. `next build` into .next-build there, at a low priority (Zeff's dev server here keeps the CPU it needs)
 *   3. the phone server stopped, .next-build becomes .next (the old one .next-old), the launcher starts it again
 *   4. a few pages asked: 200, no error page
 *
 * The first time (no worktree yet) it is made. Zeff on 9333 isn't touched.
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..");
const WT = `${ROOT}-phone`;
const PORT = Number(process.env.ZEFF_PHONE_PORT) || 9337;
const noBuild = process.argv.includes("--no-build");
const git = (...a) => execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const step = (s) => console.log(`\n▶ ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. The worktree, at master's newest commit.
if (!fs.existsSync(path.join(WT, ".git"))) {
  step(`Making the worktree ${WT}`);
  git("-C", ROOT, "worktree", "add", "--detach", WT, "master");
  const link = (kind, name) => execFileSync("cmd", ["/c", "mklink", kind, path.join(WT, name), path.join(ROOT, name)], { stdio: "ignore" });
  link("/J", "node_modules");
  link("/J", "data");
  if (fs.existsSync(path.join(ROOT, ".env"))) link("/H", ".env");
} else if (!noBuild) {
  step("Worktree to master's newest commit");
  // (A build there leaves tsconfig/next-env changes: the worktree only builds — they go.)
  git("-C", WT, "checkout", "--force", "--detach", "master");
}
console.log(git("-C", WT, "log", "--oneline", "-1").slice(0, 100));

// 2. The build, into .next-build, at a low priority.
if (!noBuild) {
  step("next build → .next-build (low priority — takes a while)");
  const t0 = Date.now();
  await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(WT, "node_modules", "next", "dist", "bin", "next"), "build"], {
      cwd: WT,
      env: { ...process.env, ZEFF_DIST_DIR: ".next-build", NEXT_TELEMETRY_DISABLED: "1", NODE_OPTIONS: "--max-old-space-size=6144" },
      stdio: "inherit",
    });
    try {
      os.setPriority(p.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {}
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`next build failed (${code})`))));
  });
  console.log(`built in ${Math.round((Date.now() - t0) / 60000)} min`);
}
if (!fs.existsSync(path.join(WT, ".next-build", "BUILD_ID"))) throw new Error(".next-build has no build.");

// 3. Swap: the server stopped (the launcher brings it back once BUILD_ID is there again), the new build in.
step("Swapping in the new build");
const next = path.join(WT, ".next");
const marker = path.join(next, "BUILD_ID");
if (fs.existsSync(marker)) fs.renameSync(marker, path.join(WT, ".next-BUILD_ID.swap")); // the launcher won't start it meanwhile
if (process.platform === "win32") {
  const pids = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique`], { encoding: "utf8" })
    .split(/\s+/)
    .filter(Boolean);
  for (const pid of pids) execFileSync("taskkill", ["/PID", pid, "/T", "/F"], { stdio: "ignore" });
  if (pids.length) console.log(`stopped the phone server (pid ${pids.join(", ")})`);
}
await sleep(1500);
fs.rmSync(path.join(WT, ".next-old"), { recursive: true, force: true });
if (fs.existsSync(next)) fs.renameSync(next, path.join(WT, ".next-old"));
const build = path.join(WT, ".next-build");
const id = path.join(build, "BUILD_ID");
const held = path.join(WT, ".next-build-BUILD_ID");
fs.renameSync(id, held);
fs.renameSync(build, next);
fs.renameSync(held, marker); // last: now the launcher starts it
fs.rmSync(path.join(WT, ".next-BUILD_ID.swap"), { force: true });

// 4. Up again, and a few pages answer.
step("Waiting for the phone server (the launcher starts it)");
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 90; i++) {
  try {
    if ((await fetch(`${base}/api/companion`, { signal: AbortSignal.timeout(5000) })).ok) break;
  } catch {}
  await sleep(2000);
}
let bad = 0;
for (const page of ["/todos", "/chat", "/heute", "/settings"]) {
  try {
    const r = await fetch(`${base}${page}`, { signal: AbortSignal.timeout(60000) });
    const text = await r.text();
    const broken = r.status >= 500 || /Application error|Internal Server Error/.test(text);
    if (broken) bad++;
    console.log(`${broken ? "✗" : "✓"} ${page} ${r.status}`);
  } catch (e) {
    bad++;
    console.log(`✗ ${page} ${e.message}`);
  }
}
if (bad) {
  console.log("\nSome pages failed — the old build is in .next-old (rename it back to .next to return to it).");
  process.exit(1);
}
console.log(`\n✔ The phone's Zeff runs ${git("-C", WT, "log", "--oneline", "-1").slice(0, 60)} on ${base}`);
