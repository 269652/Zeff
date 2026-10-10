#!/usr/bin/env node
/**
 * npm run deploy — Zeff's prod (9333) updated safely, the same way every time (whichever session
 * or person runs it):
 *   1. a lock (data/.deploy.lock): never two deploys at once
 *   2. no Ticket-Lage or work run active in any account (else: stop — or wait, with --wait)
 *   3. typecheck, lint (errors), tests (npm test)
 *   4. next build (+ the knowledge server's with --knowledge)
 *   5. again: nothing running (a run started meanwhile: wait for it)
 *   6. restart through the launcher (it must be running: it brings the server back)
 *   7. the server checked: running from this checkout, the main pages load
 * Flags: --wait (wait for runs instead of stopping), --knowledge (also build + restart the
 * knowledge servers), --skip-checks (no typecheck/lint/tests — only in an emergency).
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const DATA = path.join(ROOT, "data");
const LOCK = path.join(DATA, ".deploy.lock");
const PORT = 9333;
const PAGES = ["/", "/heute", "/todos", "/mail", "/kanban", "/plugins", "/sync-settings", "/auswerten", "/logins", "/feierabend"];
const args = new Set(process.argv.slice(2));
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

// 2./5. Runs active in any account.
function busyRuns() {
  const Database = require("better-sqlite3");
  const dbs = [path.join(DATA, "zeff.db")];
  try {
    for (const a of JSON.parse(fs.readFileSync(path.join(DATA, "accounts.json"), "utf8")).accounts ?? []) if (a.id !== "default") dbs.push(path.join(DATA, "accounts", a.id, "zeff.db"));
  } catch {
    // one account
  }
  const busy = [];
  for (const f of dbs) {
    if (!fs.existsSync(f)) continue;
    const db = new Database(f, { readonly: true });
    try {
      for (const t of ["board_runs", "work_runs"]) for (const r of db.prepare(`select id from ${t} where status in ('running','queued')`).all()) busy.push(`${path.relative(DATA, f)} ${t} #${r.id}`);
    } finally {
      db.close();
    }
  }
  return busy;
}
async function waitIdle(what) {
  for (let i = 0; ; i++) {
    const busy = busyRuns();
    if (!busy.length) return;
    if (!args.has("--wait") && what === "before") fail(`Es läuft gerade etwas: ${busy.join(", ")}. Später noch einmal — oder mit --wait.`);
    if (i === 0) log(`Warte auf: ${busy.join(", ")} …`);
    if (i > 120) fail(`Läuft nach 20 Minuten noch: ${busy.join(", ")}.`);
    await sleep(10000);
  }
}

function run(label, cmd, cmdArgs) {
  log(`${label} …`);
  // One command line (fixed words only, nothing from outside): the shell finds npx/npm on Windows.
  const r = spawnSync([cmd, ...cmdArgs].join(" "), { cwd: ROOT, stdio: "inherit", shell: true });
  if (r.status !== 0) fail(`${label} fehlgeschlagen (exit ${r.status}).`);
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

async function main() {
  lock();
  log(`Checkout: ${ROOT}`);
  await waitIdle("before");
  if (!args.has("--skip-checks")) {
    run("Typecheck", "npx", ["tsc", "--noEmit", "-p", "."]);
    run("Lint (Fehler)", "npx", ["eslint", "src", "--quiet"]);
    run("Tests", "npm", ["test", "--silent"]);
  } else log("⚠ Ohne Typecheck, Lint und Tests (--skip-checks).");
  run("Build", "npx", ["next", "build"]);
  if (args.has("--knowledge")) run("Build (Wissens-Server)", "npx", ["next", "build", "knowledge"]);

  await waitIdle("after");
  if (!processes().some((p) => p.Name === "Zeff.exe")) fail("Der Launcher (Zeff.exe) läuft nicht — ohne ihn käme der Server nach dem Neustart nicht wieder. Gebaut ist; starte den Launcher, dann `npm run deploy -- --skip-checks`.");
  const old = servers(new RegExp(`next.*start.*-p ${PORT}`));
  const knowledge = args.has("--knowledge") ? servers(/next.*start knowledge/) : [];
  log(`Neustart: ${[...old, ...knowledge].map((p) => p.ProcessId).join(", ") || "(kein Server lief)"}`);
  for (const p of [...old, ...knowledge]) spawnSync("taskkill", ["/PID", String(p.ProcessId), "/T", "/F"], { stdio: "ignore" });

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
