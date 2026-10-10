#!/usr/bin/env node
/**
 * Builds the self-contained Zeff bundle — what others unzip and run, no Node or npm needed:
 *
 *   dist/Zeff/Zeff.exe          the launcher: Electron's own electron.exe, renamed (not modified)
 *   dist/Zeff/resources/app/    … running launcher/ — tray icon, status window, keeps the servers
 *                               running, serves https://zeff and https://zeff:1337
 *   dist/Zeff/runtime/node.exe  this machine's Node, runs the servers
 *   dist/Zeff/app/              Zeff + the knowledge server, built, with production node_modules
 *
 * Builds in a copy (dist/Zeff/app), so the running Zeff's .next is never touched.
 *
 *   node scripts/dist.mjs                  everything
 *   node scripts/dist.mjs --zip            … and dist/Zeff.zip
 *   node scripts/dist.mjs --skip-build     reuse the current .next and knowledge/.next instead of building
 *   node scripts/dist.mjs --launcher-only  refresh just the launcher in an existing dist/Zeff
 *
 * A release — what goes out to others (npm run release):
 *
 *   node scripts/dist.mjs --release [--ref <commit|tag>]
 *
 * builds from a commit (default HEAD) — exactly what's committed there, nothing uncommitted, no tests
 * or fixtures — in %TEMP%\zeff-release\Zeff (outside the checkout: never dist/Zeff, which the running
 * launcher may use, and Next doesn't take the checkout for the project), and zips it as
 * dist/release/Zeff-<version>.zip (version: the tag, else the commit). Nothing of this machine goes
 * in: no zeff-launcher.json, no data, no .env.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const args = new Set(argv);
const release = args.has("--release");
const ref = release ? (argv.includes("--ref") ? argv[argv.indexOf("--ref") + 1] : "HEAD") : null;
if (release && (!ref || ref.startsWith("--"))) throw new Error("--ref needs a commit or a tag.");
if (release && (args.has("--launcher-only") || args.has("--skip-build"))) throw new Error("--release builds everything from the commit — without --launcher-only / --skip-build.");
const releaseDir = path.join(os.tmpdir(), "zeff-release");
const out = release ? path.join(releaseDir, "Zeff") : path.join(root, "dist", "Zeff");
const app = path.join(out, "app");
/** A release's sources: the commit, unpacked (its launcher/ too). */
const staging = path.join(releaseDir, ".src");
/** A release's build opens a database (pages rendered at build time): this one, made once beforehand. */
const buildDb = path.join(releaseDir, ".build-data", "zeff.db");
const launcher = release ? path.join(staging, "launcher") : path.join(root, "launcher");
/** Electron itself (not in git): from the checkout's launcher/node_modules. */
const electronFrom = path.join(root, "launcher");
const tarExe = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
const git = (gitArgs) => execFileSync("git", gitArgs, { cwd: root, encoding: "utf8" }).trim();
const version = release ? git(["describe", "--tags", "--always", ref]) : null;

const step = (msg) => console.log(`\n▶ ${msg}`);
const run = (cmd, argv, opts = {}) => {
  const r = spawnSync(cmd, argv, { stdio: "inherit", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(" ")} failed (${r.error?.message ?? `exit ${r.status}`})`);
};
const npm = (argv, cwd) => run(process.platform === "win32" ? "npm.cmd" : "npm", argv, { cwd, shell: true });
const copyDir = (from, to, skip = () => false) => fs.cpSync(from, to, { recursive: true, filter: (src) => !skip(path.relative(from, src)) });

/** app/: Zeff's sources, node_modules, both builds, minus dev dependencies — and runtime/node.exe. */
function buildApp() {
  if (fs.existsSync(path.join(app, "data")) || fs.existsSync(path.join(app, "knowledge", "data"))) {
    throw new Error(`${path.join(app, "data")} exists — the bundle in dist/ was run and has data. Move it away first.`);
  }
  step(`Fresh ${path.relative(root, out)}`);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(app, { recursive: true });

  let n = 0;
  if (release) {
    step(`Sources of ${ref} (${version}) — what's committed, minus launcher/, tests/, fixtures/`);
    if (git(["status", "--porcelain"])) console.log("(The working tree has uncommitted changes — they're not in the release.)");
    // node_modules come from the checkout: its dependencies should be the commit's.
    if (spawnSync("git", ["diff", "--quiet", ref, "--", "package-lock.json"], { cwd: root }).status !== 0) console.log(`(package-lock.json differs from ${ref} — node_modules are the checkout's; run npm ci at ${ref} for an exact match.)`);
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    const tarFile = path.join(releaseDir, "src.tar");
    execFileSync("git", ["archive", "--format=tar", "-o", tarFile, ref], { cwd: root });
    run(tarExe, ["-x", "-f", tarFile, "-C", staging]);
    fs.rmSync(tarFile, { force: true });
    for (const e of fs.readdirSync(staging)) {
      if (["launcher", "dist", "tests", "fixtures"].includes(e)) continue;
      fs.cpSync(path.join(staging, e), path.join(app, e), { recursive: true });
    }
    n = fs.readdirSync(app, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length;
  } else {
    step("Copying the sources (git: tracked + untracked, minus ignored)");
    const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" })
      .split("\0")
      .filter((f) => f && !/^(launcher|dist)\//.test(f));
    for (const f of files) {
      const src = path.join(root, f);
      if (!fs.existsSync(src) || fs.statSync(src).isDirectory()) continue;
      fs.mkdirSync(path.dirname(path.join(app, f)), { recursive: true });
      fs.copyFileSync(src, path.join(app, f));
      n++;
    }
  }
  console.log(`${n} files`);

  step("Copying node_modules");
  copyDir(path.join(root, "node_modules"), path.join(app, "node_modules"), (rel) => rel.startsWith(".cache"));

  const skipCache = (rel) => rel === "cache" || rel.startsWith(`cache${path.sep}`);
  if (args.has("--skip-build")) {
    step("Copying the current builds (.next, knowledge/.next)");
    copyDir(path.join(root, ".next"), path.join(app, ".next"), skipCache);
    copyDir(path.join(root, "knowledge", ".next"), path.join(app, "knowledge", ".next"), skipCache);
  } else {
    const next = path.join(app, "node_modules", "next", "dist", "bin", "next");
    const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
    if (release) {
      // The build's workers would each create and migrate a fresh database at once ("database is locked"):
      // one made and migrated first, outside the bundle.
      fs.rmSync(path.dirname(buildDb), { recursive: true, force: true });
      env.DATABASE_PATH = buildDb;
      run(process.execPath, ["--import", "tsx", "--input-type=module", "-e", 'const { getDb } = await import("@/db"); getDb();'], { cwd: app, env });
    }
    step("Building Zeff (next build)");
    run(process.execPath, [next, "build"], { cwd: app, env });
    step("Building the knowledge server (next build knowledge)");
    run(process.execPath, [next, "build", "knowledge"], { cwd: app, env });
    for (const d of [".next", path.join("knowledge", ".next")]) fs.rmSync(path.join(app, d, "cache"), { recursive: true, force: true });
    if (release) fs.rmSync(path.dirname(buildDb), { recursive: true, force: true });
  }
  // A build may open the databases; the bundle starts empty.
  for (const d of ["data", path.join("knowledge", "data")]) fs.rmSync(path.join(app, d), { recursive: true, force: true });

  step("Dropping dev dependencies (npm prune --omit=dev)");
  npm(["prune", "--omit=dev", "--no-audit", "--no-fund"], app);

  step("Node runtime");
  fs.mkdirSync(path.join(out, "runtime"), { recursive: true });
  fs.copyFileSync(process.execPath, path.join(out, "runtime", "node.exe"));
  console.log(`${process.version} from ${process.execPath}`);
}

/** Zeff.exe + Electron's files, the launcher code in resources/app, README.txt. */
function packLauncher() {
  step("Launcher (Electron)");
  const electronDir = path.join(electronFrom, "node_modules", "electron");
  if (!fs.existsSync(electronDir)) npm(["ci", "--no-audit", "--no-fund"], electronFrom);
  const dist = path.join(electronDir, "dist");
  if (!fs.existsSync(path.join(dist, "electron.exe"))) run(process.execPath, [path.join(electronDir, "install.js")], { cwd: electronDir });
  const electronVersion = JSON.parse(fs.readFileSync(path.join(electronDir, "package.json"), "utf8")).version;

  // Electron's files go next to app/ and runtime/ — replaced only for another Electron version
  // (a running Zeff.exe holds them; the launcher's code below can be swapped under it).
  const versionFile = (dir) => (fs.existsSync(path.join(dir, "version")) ? fs.readFileSync(path.join(dir, "version"), "utf8").trim() : null);
  const code = path.join(out, "resources", "app");
  if (fs.existsSync(path.join(out, "Zeff.exe")) && versionFile(out) === versionFile(dist)) {
    fs.rmSync(code, { recursive: true, force: true });
  } else {
    for (const e of fs.readdirSync(out)) {
      if (!["app", "runtime", "zeff-launcher.json"].includes(e)) fs.rmSync(path.join(out, e), { recursive: true, force: true });
    }
    copyDir(dist, out, (rel) => rel === path.join("resources", "default_app.asar"));
    fs.renameSync(path.join(out, "electron.exe"), path.join(out, "Zeff.exe"));
  }

  for (const f of ["package.json", "main.js", "preload.js", "status.html", "status.js", "icon.ico", "lib", "ps"]) {
    fs.cpSync(path.join(launcher, f), path.join(code, f), { recursive: true });
  }
  console.log(`Electron ${electronVersion} → Zeff.exe, launcher → resources/app`);

  fs.writeFileSync(
    path.join(out, "README.txt"),
    `Zeff${version ? ` ${version}` : ""}
====

Start Zeff.exe. It runs Zeff and its knowledge server and opens https://zeff in your browser.
The tray icon (bottom right; click it for the status window) has everything else: open Zeff,
start / stop / restart each server, their logs, "Start with Windows", and Quit.

The first start asks once to set up https://zeff (admin rights, Windows asks):
  - the hosts file gets "127.0.0.1 zeff knowledge.zeff"
  - Windows trusts Zeff's own certificate. It was made on this computer and its signing key
    was deleted right away, so it can't vouch for anything else.
Without admin rights Zeff runs on https://zeff.localhost instead.

Addresses
  https://zeff, https://zeff:1337     Zeff
  https://knowledge.zeff              the knowledge server
  http://127.0.0.1:9333/api/mcp       Zeff's MCP endpoint for agents (unchanged)

Your data stays in app\\data and app\\knowledge\\data: keep those folders when you update
(replace everything else). Settings like JIRA_URL go in app\\.env.
Options (ports, host name, extra environment): zeff-launcher.json next to Zeff.exe, e.g.
  { "httpsPorts": [443, 1337], "zeffPort": 9333, "knowledgePort": 9555, "env": { } }
`,
  );
}

if (args.has("--launcher-only")) {
  if (!fs.existsSync(app)) throw new Error(`${app} doesn't exist yet — run without --launcher-only first.`);
} else {
  buildApp();
}
packLauncher();

if (release) {
  // Nothing of this machine: no launcher options (they'd point at this checkout), no data, no secrets.
  fs.rmSync(staging, { recursive: true, force: true });
  const mine = ["zeff-launcher.json", path.join("app", "data"), path.join("app", "knowledge", "data"), path.join("app", ".env"), path.join("app", ".env.local")].filter((f) => fs.existsSync(path.join(out, f)));
  if (mine.length) throw new Error(`Not for a release: ${mine.join(", ")} in ${out}.`);
}

if (args.has("--zip") || release) {
  step("Zipping");
  const name = release ? `Zeff-${version}.zip` : "Zeff.zip";
  const zip = release ? path.join(root, "dist", "release", name) : path.join(root, "dist", name);
  fs.mkdirSync(path.dirname(zip), { recursive: true });
  fs.rmSync(zip, { force: true });
  // Windows' own bsdtar (zips by extension) — not Git's GNU tar, which may come first on PATH.
  run(tarExe, ["-a", "-c", "-f", zip, "Zeff"], { cwd: path.dirname(out) });
  console.log(`${zip} (${(fs.statSync(zip).size / 1048576).toFixed(0)} MB)`);
}

const size = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true, recursive: true }).reduce((s, e) => (e.isFile() ? s + fs.statSync(path.join(e.parentPath, e.name)).size : s), 0);
console.log(`\n✔ ${out} (${(size(out) / 1048576).toFixed(0)} MB)`);
