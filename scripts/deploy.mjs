#!/usr/bin/env node
/**
 * npm run deploy — Zeff's prod (9333) updated safely, the same way every time (whichever session
 * or person runs it):
 *   1. a lock (data/.deploy.lock): never two deploys at once
 *   2. no Ticket-Lage or work run active in any account (else: stop — or wait, with --wait);
 *      work runs on the launcher's work host don't count: they outlive the restart; nor do an
 *      agent's runs (an outside session through the MCP: nothing of it lives in the server)
 *   3. typecheck, lint (errors), tests (npm test)
 *   4. next build (+ the knowledge server's with --knowledge) — into .next-build, while the
 *      server keeps serving .next undisturbed
 *   5. again: nothing running (a run started meanwhile: wait for it)
 *   6. restart through the launcher (it must be running: it brings the server back), the new
 *      build swapped into .next while the server is down (scripts/swap-dist.mjs)
 *      A work session may deploy: its own run (ZEFF_WORK_RUN) isn't waited for, and its worker lives
 *      on the launcher's work host, not under the server that is restarted. A session started
 *      by the server itself (no host) would be killed with it: refused.
 *   7. the server checked: running from this checkout, the main pages load
 *   The sync host (second server from the same code, from its own build folder .next-sync) is restarted only
 *   when it has nothing to do — a sync or a briefing running there doesn't block the deploy of the pages and
 *   isn't cut off by it. Busy: its new build waits in .next-sync-build (`--sync-only` takes it over later).
 * Flags: --wait (wait for runs instead of stopping), --knowledge (also build + restart the
 * knowledge servers), --sync (also wait until the sync host is idle and restart it), --sync-only (no build:
 * the host takes the build that waits), --no-sync (leave the sync host alone), --skip-checks (no
 * typecheck/lint/tests — only in an emergency).
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { LIVE, OLD, STAGE, SYNC, clearStage, copyForSyncHost, swapDists } from "./swap-dist.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const DATA = path.join(ROOT, "data");
const LOCK = path.join(DATA, ".deploy.lock");
const PORT = 9333;
/** The sync host's port (launcher: syncPort): the syncs, the scheduler and the briefing run there, so restarting the pages doesn't touch them. */
const SYNC_PORT = 9336;
const PAGES = ["/", "/heute", "/todos", "/mail", "/kanban", "/plugins", "/sync-settings", "/auswerten", "/logins", "/feierabend"];
const args = new Set(process.argv.slice(2));
/** The work run this deploy is part of (a session's worker passes it down in its environment), if any. */
const OWN_RUN = process.env.ZEFF_WORK_RUN ? { id: Number(process.env.ZEFF_WORK_RUN), account: process.env.ZEFF_WORK_ACCOUNT || "default" } : null;
const require = createRequire(path.join(ROOT, "package.json"));

const log = (...a) => console.log("[deploy]", ...a);
const fail = (msg) => {
  console.error(`\n[deploy] ✖ ${msg}`);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. The lock.
function lock() {
  if (fs.existsSync(LOCK)) {
    try {
      const l = JSON.parse(fs.readFileSync(LOCK, "utf8"));
      let alive = false;
      try {
        process.kill(l.pid, 0);
        alive = true;
      } catch {
        alive = false;
      }
      if (alive && Date.now() - l.at < 60 * 60000) fail(`Ein Deploy läuft schon (pid ${l.pid}, seit ${new Date(l.at).toLocaleTimeString("de-DE")}). Warte, bis er fertig ist.`);
    } catch {
      // a broken lock: taken over
    }
  }
  fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: Date.now() }));
  const free = () => fs.rmSync(LOCK, { force: true });
  process.on("exit", free);
  process.on("SIGINT", () => process.exit(130));
}

/**
 * The work runs whose worker lives on the launcher's work host ("account:id"): a restart of the
 * server doesn't touch them — the host tells the server when they end, retrying until it is up.
 * Only those still running (the host's list, and their process alive).
 */
function hostedRuns() {
  const hosted = new Set();
  try {
    for (const c of JSON.parse(fs.readFileSync(path.join(DATA, "launcher", "work-host.json"), "utf8"))) {
      if (c.ended) continue;
      try {
        process.kill(c.pid, 0);
        hosted.add(`${c.account}:${c.runId}`);
      } catch {
        // the process is gone: not hosted any more
      }
    }
  } catch {
    // no host, no state
  }
  return hosted;
}

// 2./5. Runs active in any account. A work run on the work host doesn't count: it outlives the restart.
function busyRuns({ skipBoards = false } = {}) {
  const hosted = hostedRuns();
  const Database = require("better-sqlite3");
  const dbs = [{ id: "default", file: path.join(DATA, "zeff.db") }];
  try {
    for (const a of JSON.parse(fs.readFileSync(path.join(DATA, "accounts.json"), "utf8")).accounts ?? []) if (a.id !== "default") dbs.push({ id: a.id, file: path.join(DATA, "accounts", a.id, "zeff.db") });
  } catch {
    // one account
  }
  const busy = [];
  for (const { id: account, file: f } of dbs) {
    if (!fs.existsSync(f)) continue;
    const db = new Database(f, { readonly: true });
    try {
      // (The sync host's briefing runs are its own: they don't hold back the pages' server.)
      for (const t of skipBoards ? ["work_runs"] : ["board_runs", "work_runs"])
        for (const r of db.prepare(`select id, status${t === "work_runs" ? ", provider" : ""} from ${t} where status in ('running','queued')`).all()) {
          if (OWN_RUN && t === "work_runs" && r.id === OWN_RUN.id && account === OWN_RUN.account) continue;
          // An agent's run (an outside Claude Code session on a todo, through the MCP) has no process in the server: a restart only fails its next call for a moment.
          if (t === "work_runs" && r.status === "running" && r.provider === "agent") continue;
          // A worker on the launcher's work host outlives the restart (the host reports its end).
          if (t === "work_runs" && r.status === "running" && hosted.has(`${account}:${r.id}`)) continue;
          // An administrator session runs under its own host (scripts/work-session-host.mjs): it outlives it too.
          if (t === "work_runs" && fs.existsSync(path.join(path.dirname(f), "work", "sessions", `${r.id}.host.json`))) continue;
          busy.push(`${path.relative(DATA, f)} ${t} #${r.id}`);
        }
    } finally {
      db.close();
    }
  }
  return busy;
}
/**
 * What the running server does in its memory only (GET /api/busy): a Ticket-Lage run's own steps
 * after the Lage — its row says "ok" by then —, syncs, a Keep board sync … A restart would cut
 * them off. An older server without the route (or none running): nothing.
 */
async function serverBusy() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/busy`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.busy) ? j.busy.map((b) => `Server: ${b}`) : [];
  } catch {
    return [];
  }
}

/**
 * The sync host: whether it answers, and what it is doing (its /api/busy) — it keeps the syncs, the scheduler and
 * the briefing, so while it runs those don't count for the pages' server.
 */
async function syncHost() {
  try {
    const r = await fetch(`http://127.0.0.1:${SYNC_PORT}/api/busy`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return { up: false, busy: [] };
    const j = await r.json();
    return { up: true, busy: Array.isArray(j.busy) ? j.busy.map((b) => `Sync-Host: ${b}`) : [] };
  } catch {
    return { up: false, busy: [] };
  }
}

/** `withHost`: the sync host's work counts too (it is about to be restarted). */
async function busyNow({ withHost = false } = {}) {
  const host = await syncHost();
  const rows = busyRuns({ skipBoards: host.up && !withHost });
  // The host restarts: its runs in the database (a briefing row says "running") and what it holds in memory.
  return [...rows, ...(withHost ? host.busy : []), ...(await serverBusy())];
}

async function waitIdle(what, opts = {}) {
  for (let i = 0; ; i++) {
    const busy = await busyNow(opts);
    if (!busy.length) return;
    if (!args.has("--wait") && what === "before") fail(`Es läuft gerade etwas: ${busy.join(", ")}. Später noch einmal — oder mit --wait.`);
    if (i === 0) log(`Warte auf: ${busy.join(", ")} …`);
    if (i > 120) fail(`Läuft nach 20 Minuten noch: ${busy.join(", ")}.`);
    await sleep(10000);
  }
}

function exec(label, cmd, cmdArgs, env = {}) {
  log(`${label} …`);
  // One command line (fixed words only, nothing from outside): the shell finds npx/npm on Windows.
  return spawnSync([cmd, ...cmdArgs].join(" "), { cwd: ROOT, stdio: "inherit", shell: true, env: { ...process.env, ...env } }).status;
}
function run(label, cmd, cmdArgs) {
  const status = exec(label, cmd, cmdArgs);
  if (status !== 0) fail(`${label} fehlgeschlagen (exit ${status}).`);
}

/**
 * 4. next build into <app>/.next-build (ZEFF_DIST_DIR, next.config.ts). It points next-env.d.ts
 * at .next-build/types — put back as it was, for tsc and next dev. tsconfig.json lists
 * .next-build/types already, so the build leaves it alone.
 */
function build(label, app) {
  const envFile = path.join(app, "next-env.d.ts");
  const before = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : null;
  const status = exec(label, "npx", ["next", "build", ...(app === ROOT ? [] : [path.relative(ROOT, app)])], { ZEFF_DIST_DIR: STAGE });
  if (before !== null && fs.readFileSync(envFile, "utf8") !== before) fs.writeFileSync(envFile, before);
  if (status !== 0) fail(`${label} fehlgeschlagen (exit ${status}).`);
}

// 6. The processes (Windows): the launcher, the servers.
function processes() {
  const out = execFileSync("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('node.exe','Zeff.exe') } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress"], { encoding: "utf8" });
  const list = JSON.parse(out || "[]");
  return (Array.isArray(list) ? list : [list]).filter(Boolean);
}
const servers = (pattern) => processes().filter((p) => p.Name === "node.exe" && pattern.test(p.CommandLine ?? ""));

async function probe(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
    const body = await r.text();
    return { status: r.status, broken: /Application error|Internal Server Error|Attempted to call .* from the server/i.test(body) };
  } catch (e) {
    return { status: 0, broken: true, error: String(e?.message ?? e) };
  }
}

/**
 * The sync host takes the build that waits in .next-sync-build — when it has nothing to do (`wait`: or once it
 * hasn't). The launcher starts it again from the new build. False: it keeps its old build for now.
 */
async function swapSyncHost(wait) {
  const host = await syncHost();
  if (host.up) {
    const busy = await busyNow({ withHost: true });
    if (busy.length && !wait) {
      log(`Der Sync-Host bleibt vorerst auf seinem alten Build — er arbeitet: ${busy.join(", ")}. Der neue wartet in ${SYNC.STAGE}; später: npm run deploy -- --sync-only`);
      return false;
    }
    if (busy.length) await waitIdle("sync", { withHost: true });
  }
  const old = servers(new RegExp(`next.*start.*-p ${SYNC_PORT}`));
  log(`Sync-Host: Neustart ${old.map((p) => p.ProcessId).join(", ") || "(keiner lief)"}`);
  try {
    await swapDists([ROOT], () => {
      for (const p of old) spawnSync("taskkill", ["/PID", String(p.ProcessId), "/T", "/F"], { stdio: "ignore" });
    }, SYNC);
  } catch (e) {
    fail(`${SYNC.STAGE} → ${SYNC.LIVE} ging nicht, alles ist zurück: ${e?.message ?? e}`);
  }
  log(`${SYNC.STAGE} → ${SYNC.LIVE} getauscht (der vorige Build liegt in ${SYNC.OLD}).`);
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    await sleep(3000);
    up = (await syncHost()).up;
  }
  if (!up) fail(`Der Sync-Host antwortet nach 2 Minuten nicht auf :${SYNC_PORT} — der Launcher muss ihn starten (neu gestartet? data/logs/sync.log ansehen).`);
  log("✓ Sync-Host läuft");
  return true;
}

async function main() {
  // A session whose worker is a child of Zeff's server would be killed by the restart it asks for.
  if (OWN_RUN && !process.env.ZEFF_WORK_VIA_HOST) fail("Diese Work-Session läuft unter dem Zeff-Server selbst und würde mit dem Neustart beendet. Der Work-Host des Launchers (Tray → Work) muss laufen; starte die Session dann neu.");
  lock();
  log(`Checkout: ${ROOT}`);
  if (args.has("--sync-only")) {
    if (!fs.existsSync(path.join(ROOT, SYNC.STAGE, "BUILD_ID"))) fail(`In ${SYNC.STAGE} wartet kein Build für den Sync-Host (erst ein Deploy mit --sync oder ohne --no-sync).`);
    await swapSyncHost(true);
    log("✓ Sync-Host ausgerollt.");
    return;
  }
  await waitIdle("before");
  const apps = [ROOT, ...(args.has("--knowledge") ? [path.join(ROOT, "knowledge")] : [])];
  for (const app of apps) clearStage(app);
  if (!args.has("--skip-checks")) {
    run("Typecheck", "npx", ["tsc", "--noEmit", "-p", "."]);
    run("Lint (Fehler)", "npx", ["eslint", "src", "--quiet"]);
    run("Tests", "npm", ["test", "--silent"]);
  } else log("⚠ Ohne Typecheck, Lint und Tests (--skip-checks).");
  build("Build", ROOT);
  if (args.has("--knowledge")) build("Build (Wissens-Server)", apps[1]);
  // The sync host (once there is one, or with --sync the first time): its copy of the build, before the pages' swap moves it away.
  const hostWanted = !args.has("--no-sync") && (args.has("--sync") || fs.existsSync(path.join(ROOT, SYNC.LIVE, "BUILD_ID")));
  if (hostWanted) {
    copyForSyncHost(ROOT);
    log(`Build für den Sync-Host: ${SYNC.STAGE}`);
  } else if (!args.has("--no-sync")) log("Kein Sync-Host eingerichtet (erst mit --sync; der Launcher muss dafür neu gestartet sein).");

  await waitIdle("after");
  if (!processes().some((p) => p.Name === "Zeff.exe")) fail("Der Launcher (Zeff.exe) läuft nicht — ohne ihn käme der Server nach dem Neustart nicht wieder. Gebaut ist; starte den Launcher, dann `npm run deploy -- --skip-checks`.");
  // The sync host first: the pages' server, restarted next, then finds it (and hands its work over).
  if (hostWanted) await swapSyncHost(args.has("--sync"));
  const old = servers(new RegExp(`next.*start.*-p ${PORT}`));
  const knowledge = args.has("--knowledge") ? servers(/next.*start knowledge/) : [];
  log(`Neustart: ${[...old, ...knowledge].map((p) => p.ProcessId).join(", ") || "(kein Server lief)"}`);
  try {
    await swapDists(apps, () => {
      for (const p of [...old, ...knowledge]) spawnSync("taskkill", ["/PID", String(p.ProcessId), "/T", "/F"], { stdio: "ignore" });
    });
  } catch (e) {
    fail(`${STAGE} → ${LIVE} ging nicht, alles ist zurück (der Launcher startet den alten Build wieder): ${e?.message ?? e}`);
  }
  log(`${STAGE} → ${LIVE} getauscht (der vorige Build liegt in ${OLD}).`);

  // 7. Back, from this checkout, the pages load.
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    await sleep(3000);
    up = (await probe(`http://127.0.0.1:${PORT}/favicon.ico`)).status === 200;
  }
  if (!up) fail(`Der Server antwortet nach 2 Minuten nicht auf :${PORT} — data/logs ansehen.`);
  const now = servers(new RegExp(`next.*start.*-p ${PORT}`));
  const fromCheckout = now.some((p) => (p.CommandLine ?? "").toLowerCase().includes(path.join(ROOT, "node_modules", "next").toLowerCase()));
  if (!fromCheckout) fail(`Der Server läuft nicht aus diesem Checkout: ${now.map((p) => p.CommandLine).join(" | ")} (dist\\Zeff\\zeff-launcher.json prüfen).`);
  let bad = 0;
  for (const page of PAGES) {
    const r = await probe(`http://127.0.0.1:${PORT}${page}`);
    const ok = r.status === 200 && !r.broken;
    if (!ok) bad++;
    log(`${ok ? "✓" : "✖"} ${page} ${r.status}${r.broken ? " (Fehlerseite)" : ""}${r.error ? ` ${r.error}` : ""}`);
  }
  if (bad) fail(`${bad} Seite(n) laden nicht.`);
  log("✓ Ausgerollt.");
}

main().catch((e) => fail(String(e?.stack ?? e)));
