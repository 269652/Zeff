#!/usr/bin/env node
/**
 * One disposable Zeff dev server for tests — never the user's live one (9333), never a real database.
 *
 *   npm run test:server [-- --port 9450] [--ttl 30] [--seed e2e/seed.ts] [--force]
 *       starts `next dev` from this checkout on a fresh data folder in the temp folder (its own database, set up and
 *       with Workspace + People installed — scripts/test-server-seed.mts), prints {pid, port, url, dataDir} as JSON once
 *       it answers, and returns; the server keeps running until --stop or its TTL (minutes), after which a watchdog
 *       kills its whole process tree and removes its data folder.
 *   npm run test:server -- --stop <pid|port>     stops one (its tree, its data folder)
 *   npm run test:servers                          lists the registered ones
 *   npm run test:servers -- --reap [--dry-run]    kills every registered server past its TTL, and stray `next dev`s of
 *       worktrees / temp folders older than the TTL (never port 9333, never the main checkout's without the test marker)
 *
 * Safety: no automation Chrome (every *_CDP_ENDPOINT points at an unroutable address), no syncs (ZEFF_TEAMS_SYNC=off),
 * no AI CLI (CLAUDE_CLI/CODEX_CLI/COPILOT_CLI point at nothing), no sync host; a 3 GB heap; its own dist dir (.next-e2e).
 * Refuses to start with less than 4 GB of free RAM (--force to override).
 *
 * As a module: startTestServer(opts) / stopTestServer(pidOrPort) — the e2e runner (e2e/run.mjs) uses them.
 */
import { spawn, spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_TTL_MS, MARKER, PROTECTED_PORTS, REGISTRY_FILE, addEntry, expiresAt, isExpired, readRegistry, reapPlan, removeEntry } from "./test-servers-lib.mjs";

const REPO = path.resolve(import.meta.dirname, "..");
const NEXT_BIN = path.join(REPO, "node_modules", "next", "dist", "bin", "next");
const MIN_FREE_BYTES = 4 * 1024 ** 3;
const UNROUTABLE = "http://192.0.2.1:9222";
const CDP_VARS = ["CHRONO", "TEAMS", "GITLAB", "SIGNAL", "WHATSAPP", "OUTLOOK", "KEEP", "IMAGES", "GMAIL", "GCAL"].map((k) => `${k}_CDP_ENDPOINT`);
const win = process.platform === "win32";

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer().once("error", reject).listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const portFree = (port) =>
  new Promise((resolve) => {
    const s = net.createServer().once("error", () => resolve(false)).listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });

export const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

/** A process and everything it started. */
export function killTree(pid) {
  if (!pid || !alive(pid)) return;
  if (win) spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore", windowsHide: true });
  else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // gone
      }
    }
  }
}

/** A folder removed, a few times over (Windows keeps a file of a just-killed process locked for a moment). */
async function removeDir(dir) {
  if (!dir || !path.basename(dir).startsWith("zeff-test-server-")) return;
  for (let i = 0; i < 10; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

/** The environment of a test server: its data, and nothing that reaches out (Chrome, syncs, AI CLIs, the sync host). */
export function testEnv(dataDir, distDir) {
  const env = { ...process.env };
  for (const k of ["ZEFF_ROLE", "ZEFF_SYNC_HOST", "ZEFF_SYNC_TOKEN", "ZEFF_CDP_BASE", "ZEFF_BRIDGE_TOKEN", "ZEFF_DEV_ORIGINS", "ZEFF_TURBOPACK_ROOT", "PORT"]) delete env[k];
  const nothing = path.join(dataDir, "no-ai-cli-in-test-servers.exe");
  Object.assign(env, {
    DATABASE_PATH: path.join(dataDir, "zeff.db"),
    ZEFF_CALENDAR_INBOX: path.join(dataDir, "calendar-inbox.json"),
    ZEFF_WORK_STATE: path.join(dataDir, "work-host.json"),
    ZEFF_DIST_DIR: distDir,
    ZEFF_TEAMS_SYNC: "off",
    KNOWLEDGE_URL: "http://192.0.2.1:9555",
    CLAUDE_CLI: nothing,
    CODEX_CLI: nothing,
    COPILOT_CLI: nothing,
    NODE_OPTIONS: "--max-old-space-size=3072",
    NEXT_TELEMETRY_DISABLED: "1",
    ZEFF_TEST_SERVER: "1",
  });
  for (const k of CDP_VARS) env[k] = UNROUTABLE;
  return env;
}

/** A seed script (TypeScript, the app's own functions) run against a test server's database. */
export function runSeed(file, env) {
  const r = spawnSync(process.execPath, ["--import", "tsx", path.resolve(REPO, file)], { cwd: REPO, env, encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw new Error(`Seed ${file} failed:\n${r.stdout}\n${r.stderr}`);
  return r.stdout.trim();
}

const ownDistTaken = (dist) => readRegistry().some((e) => alive(e.pid) && e.repo === REPO && e.distDir === dist);

/**
 * Start one. Resolves with its registry entry once it answers HTTP (the first page compile is the caller's).
 * opts: { port?, ttlMs?, seeds?: string[], force?, log? }
 */
export async function startTestServer({ port, ttlMs = DEFAULT_TTL_MS, seeds = [], force = false, log = (s) => console.error(s), readyTimeoutMs = 5 * 60_000 } = {}) {
  if (!force && os.freemem() < MIN_FREE_BYTES) throw new Error(`Only ${(os.freemem() / 1024 ** 3).toFixed(1)} GB of RAM free (< 4 GB): no test server started (--force to start anyway).`);
  if (!fs.existsSync(NEXT_BIN)) throw new Error(`No Next.js at ${NEXT_BIN} (node_modules missing?).`);
  port = port ? Number(port) : await freePort();
  if (PROTECTED_PORTS.includes(port)) throw new Error(`Port ${port} is the live Zeff's.`);
  if (!(await portFree(port))) throw new Error(`Port ${port} is taken.`);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-test-server-"));
  const distDir = ownDistTaken(".next-e2e") ? `.next-e2e-${port}` : ".next-e2e";
  const env = testEnv(dataDir, distDir);
  log(`▶ test server: data ${dataDir}, port ${port}, dist ${distDir}`);
  // (What `npm run dev` does first: the generated list of mounted integrations — the seed imports the app too.)
  spawnSync(process.execPath, [path.join(REPO, "scripts", "integrations.mjs")], { cwd: REPO, stdio: "ignore", windowsHide: true });
  for (const s of ["scripts/test-server-seed.mts", ...seeds]) {
    const out = runSeed(s, env);
    if (out) log(out);
  }
  // `next dev` adds its dist dir's types to tsconfig.json (they aren't listed — on purpose: a test server killed while it writes
  // them would leave tsc a broken file): put back as it was once the server answers (or failed to).
  const tsconfig = path.join(REPO, "tsconfig.json");
  const tsBefore = fs.readFileSync(tsconfig, "utf8");
  const restoreTsconfig = () => {
    if (fs.readFileSync(tsconfig, "utf8") !== tsBefore) fs.writeFileSync(tsconfig, tsBefore);
  };
  const logFile = path.join(dataDir, "server.log");
  const out = fs.openSync(logFile, "a");
  const child = spawn(process.execPath, [MARKER, NEXT_BIN, "dev", "-H", "127.0.0.1", "-p", String(port)], { cwd: REPO, env, detached: true, stdio: ["ignore", out, out], windowsHide: true });
  child.unref();
  fs.closeSync(out);
  const startedAt = Date.now();
  const entry = { pid: child.pid, port, url: `http://localhost:${port}`, dataDir, distDir, repo: REPO, log: logFile, startedAt, ttlMs, expires: new Date(startedAt + ttlMs).toISOString() };
  addEntry(REGISTRY_FILE, entry);
  const dog = spawn(process.execPath, [path.join(REPO, "scripts", "test-server.mjs"), "--watchdog", String(child.pid)], { cwd: REPO, detached: true, stdio: "ignore", windowsHide: true });
  dog.unref();
  addEntry(REGISTRY_FILE, { ...entry, watchdogPid: dog.pid });
  const fail = async (why) => {
    const tail = safeTail(logFile);
    await stopTestServer(child.pid).catch(() => killTree(child.pid));
    restoreTsconfig();
    throw new Error(`${why} — its log:\n${tail}`);
  };
  const until = Date.now() + readyTimeoutMs;
  for (;;) {
    if (!alive(child.pid)) await fail("The test server exited while starting");
    try {
      await fetch(`http://127.0.0.1:${port}/favicon.ico`, { signal: AbortSignal.timeout(5000) });
      break;
    } catch {
      if (Date.now() > until) await fail(`The test server didn't answer within ${readyTimeoutMs / 1000} s`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  restoreTsconfig();
  log(`✔ test server ${entry.url} (pid ${entry.pid}), stops by itself at ${entry.expires}`);
  return { ...entry, watchdogPid: dog.pid };
}

const safeTail = (file) => {
  try {
    return fs.readFileSync(file, "utf8").split("\n").slice(-40).join("\n");
  } catch {
    return "(no log)";
  }
};

/** Stop one (by pid or port): its process tree, its watchdog, its data folder, its registry entry. */
export async function stopTestServer(pidOrPort) {
  const n = Number(pidOrPort);
  const e = readRegistry().find((x) => x.pid === n || x.port === n);
  if (!e) throw new Error(`No registered test server with pid or port ${pidOrPort}.`);
  if (PROTECTED_PORTS.includes(e.port)) throw new Error(`Port ${e.port} is the live Zeff's.`);
  killTree(e.pid);
  removeEntry(REGISTRY_FILE, e.pid);
  if (e.watchdogPid && e.watchdogPid !== process.pid) killTree(e.watchdogPid);
  await removeDir(e.dataDir);
  return e;
}

/** The watchdog: waits for its server's TTL (or its end), then stops it. Runs detached. */
async function watchdog(pid) {
  for (;;) {
    const e = readRegistry().find((x) => x.pid === pid);
    if (!e) return; // stopped by someone else
    if (!alive(pid) || isExpired(e, Date.now())) {
      await stopTestServer(pid).catch(() => {});
      return;
    }
    await new Promise((r) => setTimeout(r, Math.min(15_000, Math.max(1000, expiresAt(e) - Date.now()))));
  }
}

/** The node processes running now: pid, parent, command line, start, the port each listens on. */
export function listProcesses() {
  if (!win) {
    const out = execFileSync("ps", ["-eo", "pid=,ppid=,etimes=,args="], { encoding: "utf8" });
    return out
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l);
        return m ? { pid: +m[1], ppid: +m[2], startedAt: Date.now() - +m[3] * 1000, cmdline: m[4] } : null;
      })
      .filter(Boolean);
  }
  const ps = [
    "$ports = @{}; Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $ports[[int]$_.OwningProcess] = [int]$_.LocalPort }",
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; cmdline = [string]$_.CommandLine; startedAt = ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds(); port = $ports[[int]$_.ProcessId] } } | ConvertTo-Json -Compress",
  ].join("; ");
  const out = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  const v = out.trim() ? JSON.parse(out) : [];
  return (Array.isArray(v) ? v : [v]).map((p) => ({ ...p, port: p.port ?? undefined }));
}

function worktrees() {
  const out = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: REPO, encoding: "utf8" });
  return out
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => path.resolve(l.slice(9).trim()));
}

/** Kill what has outlived its time (see reapPlan); --dry-run only lists it. */
export async function reap({ dryRun = false, ttlMs = DEFAULT_TTL_MS, log = console.log } = {}) {
  const trees = worktrees();
  const registry = readRegistry();
  const plan = reapPlan(listProcesses(), { now: Date.now(), ttlMs, registry, mainCheckout: trees[0], worktrees: trees, tmpDir: os.tmpdir() });
  for (const p of plan) log(`${dryRun ? "would kill" : "killing"} ${p.pid}: ${p.reason}\n    ${p.cmdline}`);
  if (!plan.length) log("Nothing to reap.");
  if (dryRun) return plan;
  for (const p of plan) {
    const e = registry.find((x) => x.pid === p.pid);
    if (e) await stopTestServer(e.pid).catch(() => killTree(e.pid));
    else killTree(p.pid);
  }
  // Entries whose server is gone: dropped, their data folders with them.
  for (const e of readRegistry()) if (!alive(e.pid)) await stopTestServer(e.pid).catch(() => {});
  return plan;
}

function list() {
  const all = readRegistry();
  if (!all.length) return console.log("No test servers registered.");
  for (const e of all) console.log(`${alive(e.pid) ? "running" : "gone   "}  pid ${e.pid}  ${e.url}  until ${new Date(expiresAt(e)).toLocaleTimeString()}${isExpired(e, Date.now()) ? " (TTL passed)" : ""}  ${e.repo}  data ${e.dataDir}`);
}

async function main(argv) {
  const has = (f) => argv.includes(f);
  const val = (f) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (has("--watchdog")) return watchdog(Number(val("--watchdog")));
  if (has("--reap")) return void (await reap({ dryRun: has("--dry-run"), ttlMs: val("--ttl") ? Number(val("--ttl")) * 60_000 : DEFAULT_TTL_MS }));
  if (has("--list")) return list();
  if (has("--stop")) {
    const e = await stopTestServer(val("--stop"));
    return console.log(`Stopped the test server on port ${e.port} (pid ${e.pid}).`);
  }
  const seeds = argv.flatMap((a, i) => (argv[i - 1] === "--seed" ? [a] : []));
  const e = await startTestServer({ port: val("--port"), ttlMs: val("--ttl") ? Number(val("--ttl")) * 60_000 : DEFAULT_TTL_MS, seeds, force: has("--force") });
  console.log(JSON.stringify({ pid: e.pid, port: e.port, url: e.url, dataDir: e.dataDir, expires: e.expires }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
