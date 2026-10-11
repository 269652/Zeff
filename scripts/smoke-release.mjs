#!/usr/bin/env node
/**
 * Checks a release archive the way its user gets it: unpacks it into a fresh temp folder and runs
 * the launcher in it with --smoke-test — the servers start on the bundled Node, the certificate is
 * made, Zeff and the knowledge server answer over https (see runSmokeTest in launcher/main.js).
 * Its own ports and data folder, so a Zeff running on this machine is left alone; no hosts or
 * certificate setup. Prints the logs; the exit code is the launcher's (0 = ok).
 *
 *   node scripts/smoke-release.mjs dist/release/Zeff-v1.2.0-linux-x64.tar.gz
 *
 * Linux without a display: runs under xvfb-run.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const archive = path.resolve(process.argv[2] ?? "");
if (!process.argv[2] || !fs.existsSync(archive)) throw new Error("Usage: node scripts/smoke-release.mjs <release archive>");

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.error?.message ?? `exit ${r.status}`})`);
};

const work = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-smoke-"));
const unpacked = path.join(work, "unpacked");
const data = path.join(work, "data");
fs.mkdirSync(unpacked);
console.log(`▶ Unpacking ${path.basename(archive)} into ${unpacked}`);
if (process.platform === "win32") run(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-x", "-f", archive, "-C", unpacked]);
else if (process.platform === "darwin") run("ditto", ["-x", "-k", archive, unpacked]);
else run("tar", ["-xzf", archive, "-C", unpacked]);

const top = path.join(unpacked, "Zeff");
const exe = { win32: path.join(top, "Zeff.exe"), darwin: path.join(top, "Zeff.app", "Contents", "MacOS", "Electron"), linux: path.join(top, "zeff") }[process.platform];
if (!fs.existsSync(exe)) throw new Error(`${exe} isn't in the archive.`);

const config = path.join(work, "zeff-launcher.json");
fs.writeFileSync(config, JSON.stringify({ dataDir: data, zeffPort: 9433, knowledgePort: 9566, httpsPorts: [14437], httpRedirect: false }, null, 2));

let cmd = exe;
let args = ["--smoke-test", "--no-setup", "--background", "--config", config];
if (process.platform === "linux" && !process.env.DISPLAY) [cmd, args] = ["xvfb-run", ["-a", exe, ...args]];
console.log(`▶ ${cmd} ${args.join(" ")}`);
const started = Date.now();
const child = spawn(cmd, args, { stdio: "inherit", env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" } });
const timer = setTimeout(() => {
  console.log("✘ No result after 8 minutes — killing the launcher.");
  child.kill("SIGKILL");
}, 8 * 60 * 1000);
const code = await new Promise((resolve) => {
  child.on("error", (e) => {
    console.log(`✘ ${e.message}`);
    resolve(1);
  });
  child.on("exit", (c, signal) => resolve(c ?? (signal ? 1 : 0)));
});
clearTimeout(timer);

for (const log of ["launcher.log", "zeff.log", "knowledge.log"]) {
  const file = path.join(data, "logs", log);
  console.log(`\n──── ${log} ${"─".repeat(60)}`);
  console.log(fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").slice(-80).join("\n") : "(none)");
}
const launcherLog = path.join(data, "logs", "launcher.log");
const passed = code === 0 && fs.existsSync(launcherLog) && fs.readFileSync(launcherLog, "utf8").includes("smoke test passed");
console.log(`\n${passed ? "✔ passed" : `✘ failed (exit ${code})`} after ${((Date.now() - started) / 1000).toFixed(0)}s`);
fs.rmSync(work, { recursive: true, force: true, maxRetries: 5 });
process.exit(passed ? 0 : 1);
