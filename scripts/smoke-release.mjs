#!/usr/bin/env node
/**
 * Checks a release archive the way its user gets it, on a PC with nothing installed: unpacks it into a
 * fresh temp folder and runs the launcher in it with --smoke-test under a BARE environment — a PATH with
 * only the system's own folders (no Node, npm, git, uv, Chrome), so everything must come from the bundle:
 *
 *   1. the launcher starts the servers on the bundled Node, makes the certificate, and Zeff and the
 *      knowledge server answer over https and the pages (/heute /todos /mail /kanban /plugins /work …)
 *      render (see runSmokeTest in launcher/main.js);
 *   2. the bundle's own Node runs app/scripts/bundle-check.mjs: the files the app reads are there, the
 *      production dependencies resolve and better-sqlite3 loads, every plugin driver answers an MCP
 *      handshake, the work hosts start, the database is migrated to the last migration, nothing of the
 *      build machine (this home folder, the checkout, tokens, data, .env) is inside.
 *
 * Its own free ports and data folder, so a Zeff running on this machine is left alone; no hosts or
 * certificate setup. Prints the logs; the exit code is 0 only when both passed.
 *
 *   node scripts/smoke-release.mjs dist/release/Zeff-v1.2.0-linux-x64.tar.gz [--inherit-env] [--keep]
 *
 *   --inherit-env   run with this shell's PATH instead of the bare one
 *   --keep          leave the unpacked folder and its data (the path is printed)
 *
 * Linux without a display: runs under xvfb-run.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
const archive = path.resolve(process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "");
if (!process.argv.slice(2).some((a) => !a.startsWith("--")) || !fs.existsSync(archive)) throw new Error("Usage: node scripts/smoke-release.mjs <release archive> [--inherit-env] [--keep]");
const repo = path.resolve(import.meta.dirname, "..");

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.error?.message ?? `exit ${r.status}`})`);
};
const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const work = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-smoke-"));
const unpacked = path.join(work, "unpacked");
const data = path.join(work, "data");
fs.mkdirSync(unpacked);
console.log(`▶ Unpacking ${path.basename(archive)} into ${unpacked}`);
if (process.platform === "win32") run(path.join(process.env.SystemRoot ?? "C:\Windows", "System32", "tar.exe"), ["-x", "-f", archive, "-C", unpacked]);
else if (process.platform === "darwin") run("ditto", ["-x", "-k", archive, unpacked]);
else run("tar", ["-xzf", archive, "-C", unpacked]);

const top = path.join(unpacked, "Zeff");
const exe = { win32: path.join(top, "Zeff.exe"), darwin: path.join(top, "Zeff.app", "Contents", "MacOS", "Electron"), linux: path.join(top, "zeff") }[process.platform];
if (!fs.existsSync(exe)) throw new Error(`${exe} isn't in the archive.`);
const bundle = process.platform === "darwin" ? path.join(top, "Zeff.app", "Contents", "Resources", "zeff") : top;
const nodeExe = path.join(bundle, "runtime", process.platform === "win32" ? "node.exe" : "node");

// Free ports: the smoke test runs next to a Zeff on this machine (9333, 9555, the work host's 9334 …).
const ports = { zeffPort: await freePort(), knowledgePort: await freePort(), workPort: await freePort() };
const httpsPort = await freePort();
const config = path.join(work, "zeff-launcher.json");
fs.writeFileSync(config, JSON.stringify({ dataDir: data, ...ports, httpsPorts: [httpsPort], httpRedirect: false }, null, 2));

// A PC with nothing installed: the system's own folders on the PATH, nothing else.
const SYS = process.env.SystemRoot ?? "C:\Windows";
const barePath = process.platform === "win32" ? [path.join(SYS, "System32"), SYS, path.join(SYS, "System32", "Wbem"), path.join(SYS, "System32", "WindowsPowerShell", "v1.0")].join(";") : "/usr/bin:/bin:/usr/sbin:/sbin";
const inherit = flags.includes("--inherit-env");
// Its temp folder inside the work folder: the launcher's throwaway Electron profile is removed with it.
const tmp = path.join(work, "t");
fs.mkdirSync(tmp);
const env = { ...process.env, ELECTRON_ENABLE_LOGGING: "1", TEMP: tmp, TMP: tmp, TMPDIR: tmp };
if (!inherit) for (const k of Object.keys(env)) if (k.toLowerCase() === "path") delete env[k];
if (!inherit) env[process.platform === "win32" ? "Path" : "PATH"] = barePath;
console.log(inherit ? "▶ PATH: this shell's" : `▶ PATH: only the system's (${barePath})`);

let cmd = exe;
let args = ["--smoke-test", "--no-setup", "--background", "--config", config];
if (process.platform === "linux" && !process.env.DISPLAY) [cmd, args] = ["xvfb-run", ["-a", exe, ...args]];
console.log(`▶ ${cmd} ${args.join(" ")}`);
const started = Date.now();
const child = spawn(cmd, args, { stdio: "inherit", env });
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
const started1 = code === 0 && fs.existsSync(launcherLog) && fs.readFileSync(launcherLog, "utf8").includes("smoke test passed");
console.log(`\n${started1 ? "✔ launcher smoke test passed" : `✘ launcher smoke test failed (exit ${code})`} after ${((Date.now() - started) / 1000).toFixed(0)}s`);

// The bundle's own files and programs, with the bundle's own Node.
let checked = false;
if (started1) {
  console.log("\n▶ Bundle checks (app/scripts/bundle-check.mjs, run by the bundled Node)");
  const r = spawnSync(nodeExe, [path.join(bundle, "app", "scripts", "bundle-check.mjs"), "--data", data, ...[os.homedir(), repo].filter((f) => f.length > 8).flatMap((f) => ["--forbid", f])], { stdio: "inherit", env, cwd: path.join(bundle, "app") });
  checked = r.status === 0;
}

const passed = started1 && checked;
console.log(`\n${passed ? "✔ release check passed" : "✘ release check FAILED"}`);
if (flags.includes("--keep")) console.log(`(kept: ${work})`);
else fs.rmSync(work, { recursive: true, force: true, maxRetries: 5 });
process.exit(passed ? 0 : 1);
