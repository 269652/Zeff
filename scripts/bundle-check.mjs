#!/usr/bin/env node
/**
 * Checks the Zeff folder it sits in (app/ of a bundle) the way a PC without anything installed runs
 * it — with the Node that runs this script, nothing else:
 *
 *   node scripts/bundle-check.mjs [--data <folder with zeff.db>] [--forbid <text>]...
 *
 *   files     what the app reads at run time is there: drizzle/ (every migration), the scripts, every
 *             plugin driver, the external plugins' docs (docs/plugins), .mcp.json, both builds
 *   modules   every dependency of package.json resolves; better-sqlite3's native binding loads
 *   drivers   each src/plugins/<id>/driver.mjs and the MCP scripts start as an MCP server over stdio and
 *             answer initialize + tools/list (their imports — playwright-core … — resolve; no browser needed)
 *   hosts     scripts/work-host.mjs and scripts/work-session-host.mjs start, answer, stop
 *   database  --data: zeff.db is migrated to the last migration in drizzle/meta/_journal.json
 *   leaks     nothing of the build machine: no data/, .env, zeff-launcher.json; no --forbid text (its home
 *             folder, the checkout) in the config and sources; no token-looking strings
 *
 * scripts/smoke-release.mjs runs it with the bundled Node after the launcher's own smoke test. Exit code 1
 * when anything failed.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const opt = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
const dataDir = opt("--data");
const forbid = argv.flatMap((a, i) => (a === "--forbid" && argv[i + 1] ? [argv[i + 1]] : [])).filter((s) => s.length > 3);

let failures = 0;
const ok = (msg) => console.log(`  ✔ ${msg}`);
const bad = (msg) => {
  failures++;
  console.log(`  ✘ ${msg}`);
};
const check = (cond, good, why) => (cond ? ok(good) : bad(why ?? good));
const section = (name) => console.log(`\n▶ ${name}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");
const has = (...p) => fs.existsSync(path.join(root, ...p));
const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

// ---------------------------------------------------------------------------
section("files the app reads at run time");
const journal = JSON.parse(read("drizzle", "meta", "_journal.json"));
const missingSql = journal.entries.filter((e) => !has("drizzle", `${e.tag}.sql`)).map((e) => e.tag);
check(!missingSql.length, `drizzle/: ${journal.entries.length} migrations, each with its .sql`, `drizzle/ lacks ${missingSql.join(", ")}`);
const scripts = ["work-host.mjs", "work-session-host.mjs", "work-host-spool.mjs", "chrome-cdp.mjs", "chrome-open.mjs", "browser-find.mjs", "images-mcp.mjs", "chrono-mcp.mjs"];
const lackScripts = scripts.filter((f) => !has("scripts", f));
check(!lackScripts.length, `scripts/: ${scripts.length} run-time scripts`, `scripts/ lacks ${lackScripts.join(", ")}`);
const pluginDirs = fs.readdirSync(path.join(root, "src", "plugins"), { withFileTypes: true }).filter((e) => e.isDirectory());
const drivers = pluginDirs.filter((e) => has("src", "plugins", e.name, "driver.mjs")).map((e) => path.join("src", "plugins", e.name, "driver.mjs"));
check(drivers.length >= 9, `${drivers.length} plugin drivers`, `only ${drivers.length} plugin drivers`);
for (const f of [".mcp.json", "package.json", "next.config.ts", ".next/BUILD_ID", "knowledge/.next/BUILD_ID", "node_modules/next/package.json", "node_modules/better-sqlite3/package.json"]) check(has(...f.split("/")), f, `${f} is missing`);
// The documents of external plugins: shown at /ext/docs and served as Markdown at /ext/raw/<name> (src/app/ext).
const pluginDocs = ["README", "manifest", "api", "panels", "hooks", "security"];
const lackDocs = pluginDocs.filter((f) => !has("docs", "plugins", `${f}.md`));
check(!lackDocs.length, `docs/plugins/: the ${pluginDocs.length} documents of external plugins`, `docs/plugins/ lacks ${lackDocs.join(", ")}`);
const pkg = JSON.parse(read("package.json"));

// ---------------------------------------------------------------------------
section("modules (production dependencies only)");
const require = createRequire(path.join(root, "package.json"));
for (const dep of Object.keys(pkg.dependencies ?? {})) {
  try {
    import.meta.resolve(dep); // from this file: app/node_modules
    ok(dep);
  } catch (e) {
    bad(`${dep}: ${String(e?.message ?? e).split(String.fromCharCode(10))[0]}`);
  }
}
// The ones the drivers and the work hosts load at run time: really imported.
for (const dep of ["playwright-core"]) {
  try {
    const m = await import(dep);
    check(Object.keys(m).length > 0, `import ${dep}`);
  } catch (e) {
    bad(`import ${dep}: ${e.message}`);
  }
}
try {
  const Database = require("better-sqlite3");
  const db = new Database(":memory:");
  check(db.prepare("select 1 as x").get().x === 1, "better-sqlite3's native binding loads and runs");
  db.close();
} catch (e) {
  bad(`better-sqlite3: ${e.message}`);
}

// ---------------------------------------------------------------------------
section("drivers and MCP scripts: initialize + tools/list over stdio");
/** Starts an MCP server script, does the handshake, returns its tool names. */
function handshake(script, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, script)], { cwd: root, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let buf = "";
    let err = "";
    const send = (o) => child.stdin.write(`${JSON.stringify(o)}\n`);
    const done = (fn, v) => {
      clearTimeout(timer);
      child.kill();
      fn(v);
    };
    const timer = setTimeout(() => done(reject, new Error(`no answer in 20 s${err ? ` (stderr: ${err.slice(0, 300)})` : ""}`)), 20000);
    child.on("error", (e) => done(reject, e));
    child.on("exit", (code) => done(reject, new Error(`exited (${code}) ${err.slice(0, 300)}`)));
    child.stderr.on("data", (d) => (err += d));
    child.stdout.on("data", (d) => {
      buf += d;
      let n;
      while ((n = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, n).trim();
        buf = buf.slice(n + 1);
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 1) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        } else if (msg.id === 2) done(resolve, (msg.result?.tools ?? []).map((t) => t.name));
      }
    });
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "bundle-check", version: "1" } } });
  });
}
// A browser that isn't there: the handshake never needs one.
const deadChrome = "http://127.0.0.1:9";
const cdpEnv = Object.fromEntries(["CHRONO", "TEAMS", "GITLAB", "OUTLOOK", "GMAIL", "WHATSAPP", "KEEP", "GCAL"].map((k) => [`${k}_CDP_ENDPOINT`, deadChrome]));
for (const script of [...drivers, path.join("scripts", "chrono-mcp.mjs"), path.join("scripts", "images-mcp.mjs")]) {
  try {
    const tools = await handshake(script, cdpEnv);
    check(tools.length > 0, `${script.replace(/\\/g, "/")}: ${tools.length} tools`, `${script}: tools/list is empty`);
  } catch (e) {
    bad(`${script.replace(/\\/g, "/")}: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
section("work host and session host start and stop");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-bundle-check-"));
try {
  const port = await freePort();
  const host = spawn(process.execPath, [path.join(root, "scripts", "work-host.mjs")], {
    cwd: root,
    env: { ...process.env, ZEFF_WORK_PORT: String(port), ZEFF_WORK_TOKEN: "check", ZEFF_WORK_STATE: path.join(tmp, "work-host.json"), ZEFF_URL: "http://127.0.0.1:9" },
    stdio: "ignore",
    windowsHide: true,
  });
  let health = null;
  for (let i = 0; i < 40 && !health; i++) {
    await sleep(250);
    health = await fetch(`http://127.0.0.1:${port}/health`, { headers: { "x-zeff-work-token": "check" } }).then((r) => r.json()).catch(() => null);
  }
  check(health?.ok === true, `work-host.mjs answers /health (features: ${(health?.features ?? []).join(", ")})`, "work-host.mjs didn't answer /health");
  const denied = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.status).catch(() => 0);
  check(denied === 403, "… and refuses a request without its token");
  host.kill();

  const cfg = {
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 60000)"],
    cwd: tmp,
    log: path.join(tmp, "session.log"),
    err: path.join(tmp, "session.err"),
    info: path.join(tmp, "session.info.json"),
    token: "check-token",
  };
  fs.writeFileSync(path.join(tmp, "session.json"), JSON.stringify(cfg));
  const sess = spawn(process.execPath, [path.join(root, "scripts", "work-session-host.mjs"), path.join(tmp, "session.json")], { cwd: root, stdio: "ignore", windowsHide: true });
  let info = null;
  for (let i = 0; i < 40 && !info; i++) {
    await sleep(250);
    try {
      info = JSON.parse(fs.readFileSync(cfg.info, "utf8"));
    } catch {
      // not yet
    }
  }
  check(!!info?.port, "work-session-host.mjs starts its CLI and listens", "work-session-host.mjs wrote no info file");
  if (info?.port) {
    const reply = await new Promise((resolve) => {
      const s = net.connect(info.port, "127.0.0.1", () => s.write(`${cfg.token}\n`));
      s.setEncoding("utf8");
      s.on("data", (d) => {
        if (/ok/.test(d)) {
          s.write(`${JSON.stringify({ zeffHost: "kill" })}\n`);
          resolve("ok");
        }
      });
      s.on("error", () => resolve("error"));
      setTimeout(() => resolve("timeout"), 5000);
    });
    check(reply === "ok", "… takes the token and a stop", `session host: ${reply}`);
    for (let i = 0; i < 40 && fs.existsSync(cfg.info); i++) await sleep(250);
    check(!fs.existsSync(cfg.info), "… and ends with its CLI", "the session host didn't end");
  }
  sess.kill();
} finally {
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
}

// ---------------------------------------------------------------------------
if (dataDir) {
  section(`database ${path.join(dataDir, "zeff.db")}`);
  try {
    const Database = require("better-sqlite3");
    const db = new Database(path.join(dataDir, "zeff.db"), { readonly: true });
    const n = db.prepare("select count(*) as n from __drizzle_migrations").get().n;
    const tables = db.prepare("select count(*) as n from sqlite_master where type = 'table'").get().n;
    db.close();
    check(n === journal.entries.length, `migrated from scratch to the last migration (${journal.entries.at(-1).tag}): ${n} of ${journal.entries.length}, ${tables} tables`, `${n} migrations applied, the journal has ${journal.entries.length}`);
  } catch (e) {
    bad(`zeff.db: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
section("nothing of the build machine");
const parent = path.dirname(root);
for (const f of [path.join(root, "data"), path.join(root, "knowledge", "data"), path.join(root, ".env"), path.join(root, ".env.local"), path.join(parent, "zeff-launcher.json")]) {
  check(!fs.existsSync(f), `no ${path.relative(parent, f).replace(/\\/g, "/")}`, `${f} exists`);
}
const SECRET = /(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|glpat-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{30,}|xox[bpa]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
const TEXT = /\.(json|mjs|cjs|js|ts|tsx|md|txt|sql|yml|yaml|toml|env|example|css|html|ps1|sh)$/i;
let scanned = 0;
const hits = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (["node_modules", ".next"].includes(e.name)) continue;
      walk(p);
    } else if (TEXT.test(e.name) && fs.statSync(p).size < 2_000_000) {
      scanned++;
      const text = fs.readFileSync(p, "utf8");
      for (const f of forbid) if (text.includes(f) || text.includes(f.replace(/\\/g, "/"))) hits.push(`${path.relative(root, p)}: contains ${f}`);
      const s = SECRET.exec(text);
      if (s) hits.push(`${path.relative(root, p)}: looks like a secret (${s[1].slice(0, 8)}…)`);
    }
  }
};
walk(root);
check(!hits.length, `${scanned} config and source files: no path of the build machine${forbid.length ? "" : " (no --forbid given)"}, no tokens`, hits.slice(0, 8).join("\n    "));

console.log(`\n${failures ? `✘ ${failures} check(s) failed` : "✔ bundle checks passed"}`);
process.exit(failures ? 1 : 0);
