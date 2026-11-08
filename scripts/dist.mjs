#!/usr/bin/env node
/**
 * Builds the self-contained Zeff bundle for the platform it runs on — what others unpack and
 * run, no Node or npm needed:
 *
 *   Windows  dist/Zeff/                  Zeff.exe: Electron's own electron.exe, renamed (not modified)
 *   Linux    dist/Zeff/                  ./zeff (a start script) → zeff-launcher: Electron's binary
 *   macOS    dist/Zeff/Zeff.app/         Electron.app, renamed Zeff.app, signed ad hoc
 *
 * in each, the launcher (launcher/: tray icon, status window, keeps the servers running, serves
 * https://zeff and https://zeff:1337) in Electron's resources/app, and next to it — in Zeff.app,
 * in Contents/Resources/zeff — the bundle proper:
 *
 *   runtime/node[.exe]   this machine's Node, runs the servers
 *   app/                 Zeff + the knowledge server, built, with production node_modules
 *
 * Native modules (better-sqlite3) are this machine's: a bundle is built on the platform it's for
 * (the release workflow, .github/workflows/release.yml, builds on each). Builds in a copy (app/),
 * so the running Zeff's .next is never touched.
 *
 *   node scripts/dist.mjs                  everything
 *   node scripts/dist.mjs --zip            … and dist/Zeff.zip (Linux: .tar.gz)
 *   node scripts/dist.mjs --skip-build     reuse the current .next and knowledge/.next instead of building
 *   node scripts/dist.mjs --launcher-only  refresh just the launcher in an existing bundle
 *
 * A release — what goes out to others (npm run release):
 *
 *   node scripts/dist.mjs --release [--ref <commit|tag>] [--no-check] [--allow-dirty]
 *
 * builds from a commit (default HEAD) — exactly what's committed there, nothing uncommitted, no tests
 * or fixtures — in <temp>/zeff-release (outside the checkout: never dist/, which the running
 * launcher may use, and Next doesn't take the checkout for the project), and packs it as
 * dist/release/Zeff-<version>-<os>-<arch>.zip (Linux: .tar.gz; version: the tag, else the commit).
 * Nothing of this machine goes in: no zeff-launcher.json, no data, no .env.
 *
 *   - It refuses when the working tree has uncommitted changes that belong in the build (they would be
 *     left out): commit them, or --allow-dirty to build the commit as it is. --ref <other commit> doesn't
 *     look at the working tree.
 *   - It ends by printing the archive, its size and sha256 (also written to <archive>.sha256) and the
 *     version, then checks the archive it just built (scripts/smoke-release.mjs: unpack, start with a
 *     bare PATH, open the pages, check the files). The exit code is 1 when the check fails; --no-check
 *     skips it (the release workflow runs it as its own step).
 */
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
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

const PLATFORM = process.platform;
const WIN = PLATFORM === "win32";
const MAC = PLATFORM === "darwin";
if (!["win32", "darwin", "linux"].includes(PLATFORM)) throw new Error(`No bundle for ${PLATFORM}.`);
/** The release's name for this platform: windows-x64, macos-arm64, linux-x64, … */
const target = `${{ win32: "windows", darwin: "macos", linux: "linux" }[PLATFORM]}-${process.arch}`;

// (Windows: not under the user's profile — Next writes the build's absolute paths into .next, and a temp folder under
// C:\Users\<name> put the builder's name into every release.)
const releaseDir = WIN ? path.join(process.env.PUBLIC || "C:\\Users\\Public", "zeff-release") : path.join(os.tmpdir(), "zeff-release");
/** The folder that gets packed: Zeff/ — with README.txt, and on macOS Zeff.app in it. */
const top = path.join(release ? releaseDir : path.join(root, "dist"), "Zeff");
/** The launcher: the bundle's folder (Windows, Linux) or Zeff.app. */
const out = MAC ? path.join(top, "Zeff.app") : top;
/** Where app/ and runtime/ go. */
const bundle = MAC ? path.join(out, "Contents", "Resources", "zeff") : out;
/** The launcher's code: Electron's resources/app. */
const code = MAC ? path.join(out, "Contents", "Resources", "app") : path.join(out, "resources", "app");
const app = path.join(bundle, "app");
const nodeExe = path.join(bundle, "runtime", WIN ? "node.exe" : "node");
/** A release's sources: the commit, unpacked (its launcher/ too). */
const staging = path.join(releaseDir, ".src");
/** A release's build opens a database (pages rendered at build time): this one, made once beforehand. */
const buildDb = path.join(releaseDir, ".build-data", "zeff.db");
const launcher = release ? path.join(staging, "launcher") : path.join(root, "launcher");
/** Electron itself (not in git): from the checkout's launcher/node_modules. */
const electronFrom = path.join(root, "launcher");
// Windows' own bsdtar (zips by extension) — not Git's GNU tar, which may come first on PATH.
const tarExe = WIN ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
const git = (gitArgs) => execFileSync("git", gitArgs, { cwd: root, encoding: "utf8" }).trim();
const version = release ? git(["describe", "--tags", "--always", ref]) : null;
const commit = release ? git(["rev-parse", "--short=12", ref]) : null;
/** The tag when the commit is exactly one (a clean release), else null. */
const exactTag = release
  ? (() => {
      try {
        return execFileSync("git", ["describe", "--tags", "--exact-match", ref], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      } catch {
        return null;
      }
    })()
  : null;

/**
 * A release is built from a commit: uncommitted changes aren't in it. When that is HEAD and the working
 * tree has changes that belong in the build, stop (they'd be left out unnoticed) — unless --allow-dirty.
 * What isn't shipped anyway (tests/, fixtures/, .github/) doesn't count.
 */
function checkWorkingTree() {
  if (ref !== "HEAD") return;
  // not git(): its trim() would eat the first line's leading status column
  const changed = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .map((l) => l.slice(3).trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
  const relevant = changed.filter((f) => !/^(tests|fixtures|\.github)\//.test(f));
  if (relevant.length && !args.has("--allow-dirty")) {
    console.error(`\n✘ The working tree has ${relevant.length} uncommitted change(s) that belong in the release — a release is built from the commit, so they would be left out:`);
    for (const f of relevant.slice(0, 15)) console.error(`    ${f}`);
    if (relevant.length > 15) console.error(`    … and ${relevant.length - 15} more`);
    console.error("  Commit them (and tag the release: git tag v1.2.3), build another commit with --ref <commit|tag>, or build this commit as it is with --allow-dirty.");
    process.exit(1);
  }
  if (changed.length) console.log(`(Uncommitted changes are not in the release: ${changed.length} file(s)${relevant.length ? " — --allow-dirty" : ", none of which is shipped"}.)`);
}

const step = (msg) => console.log(`\n▶ ${msg}`);
const run = (cmd, argv, opts = {}) => {
  const r = spawnSync(cmd, argv, { stdio: "inherit", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(" ")} failed (${r.error?.message ?? `exit ${r.status}`})`);
};
const npm = (argv, cwd) => run(WIN ? "npm.cmd" : "npm", argv, { cwd, shell: true });
// verbatimSymlinks: node_modules/.bin and Electron.app's frameworks link relatively — kept so.
const copyDir = (from, to, skip = () => false) =>
  fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true, filter: (src) => !skip(path.relative(from, src)) });

/** app/: Zeff's sources, node_modules, both builds, minus dev dependencies — and runtime/node. */
async function buildApp() {
  if (fs.existsSync(path.join(app, "data")) || fs.existsSync(path.join(app, "knowledge", "data"))) {
    throw new Error(`${path.join(app, "data")} exists — the bundle in dist/ was run and has data. Move it away first.`);
  }
  step(`Fresh ${path.relative(root, out)}`);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(app, { recursive: true });

  let n = 0;
  if (release) {
    step(`Sources of ${ref} (${version}) — what's committed, minus launcher/, tests/, fixtures/`);
    // node_modules come from the checkout: its dependencies should be the commit's.
    if (spawnSync("git", ["diff", "--quiet", ref, "--", "package-lock.json"], { cwd: root }).status !== 0) console.log(`(package-lock.json differs from ${ref} — node_modules are the checkout's; run npm ci at ${ref} for an exact match.)`);
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    const tarFile = path.join(releaseDir, "src.tar");
    execFileSync("git", ["archive", "--format=tar", "-o", tarFile, ref], { cwd: root });
    run(tarExe, ["-x", "-f", tarFile, "-C", staging]);
    fs.rmSync(tarFile, { force: true });
    for (const e of fs.readdirSync(staging)) {
      // (.gitmodules: where this machine keeps the integrations — a local path, and no submodule is in a release anyway.)
      if (["launcher", "dist", "tests", "fixtures", ".github", ".gitmodules"].includes(e)) continue;
      fs.cpSync(path.join(staging, e), path.join(app, e), { recursive: true });
    }
    n = fs.readdirSync(app, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length;
  } else {
    step("Copying the sources (git: tracked + untracked, minus ignored)");
    const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" })
      .split("\0")
      .filter((f) => f && !/^(launcher|dist|\.github)\//.test(f));
    for (const f of files) {
      const src = path.join(root, f);
      if (!fs.existsSync(src) || fs.statSync(src).isDirectory()) continue;
      fs.mkdirSync(path.dirname(path.join(app, f)), { recursive: true });
      fs.copyFileSync(src, path.join(app, f));
      n++;
    }
    // The mounted integrations (git submodules under integrations/: Chrono, Punch): git lists a submodule as one entry, so its files are copied here.
    // (A release is made from a commit: no submodule files in it — Zeff without them.)
    const mounts = path.join(root, "integrations");
    for (const m of fs.existsSync(mounts) ? fs.readdirSync(mounts, { withFileTypes: true }).filter((e) => e.isDirectory()) : []) {
      fs.cpSync(path.join(mounts, m.name), path.join(app, "integrations", m.name), { recursive: true, filter: (s) => path.basename(s) !== ".git" && path.basename(s) !== "node_modules" });
      n += fs.readdirSync(path.join(mounts, m.name), { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length;
    }
  }
  console.log(`${n} files`);

  step("Copying node_modules");
  // realpath: a node_modules that is a junction/symlink (a git worktree sharing the main checkout's) is copied as a
  // folder — copied as a link, `npm prune` below would strip the dev dependencies of the folder it points to.
  copyDir(fs.realpathSync(path.join(root, "node_modules")), path.join(app, "node_modules"), (rel) => rel.startsWith(".cache"));

  const skipCache = (rel) => rel === "cache" || rel.startsWith(`cache${path.sep}`);
  if (args.has("--skip-build")) {
    step("Copying the current builds (.next, knowledge/.next)");
    copyDir(path.join(root, ".next"), path.join(app, ".next"), skipCache);
    copyDir(path.join(root, "knowledge", ".next"), path.join(app, "knowledge", ".next"), skipCache);
  } else {
    const next = path.join(app, "node_modules", "next", "dist", "bin", "next");
    // Turbopack's root: the copy itself (its node_modules are real folders) — not next.config's fallback, the home folder.
    const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ...(release ? { ZEFF_TURBOPACK_ROOT: app } : {}) };
    // The integrations' mount files (src/lib/integrations/mounted-*.ts) are generated, not committed: written for what
    // the copy has under integrations/ — a release has none (submodules aren't in a commit), so they come out empty.
    run(process.execPath, [path.join(app, "scripts", "integrations.mjs")], { cwd: app, env });
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
  if (release) await stripSources(app);

  step("Node runtime");
  fs.mkdirSync(path.dirname(nodeExe), { recursive: true });
  fs.copyFileSync(process.execPath, nodeExe);
  fs.chmodSync(nodeExe, 0o755);
  console.log(`${process.version} (${target}) from ${process.execPath}`);
}

/** The build tooling: not run by a bundle (scripts/bundle-check.mjs stays — the smoke test runs it). */
const BUILD_ONLY = ["AGENTS.md", "CLAUDE.md", "eslint.config.mjs", "postcss.config.mjs", "tsconfig.tsbuildinfo", "site", "assets", "scripts/dist.mjs", "scripts/deploy.mjs", "scripts/site-deploy.mjs", "scripts/swap-dist.mjs", "scripts/integrations.mjs", "scripts/keep-write-check.mjs", "knowledge/postcss.config.mjs", "knowledge/tsconfig.tsbuildinfo"];
/** What a bundle runs from its builds alone: TypeScript and CSS (next.config.ts stays — next start reads it — and what it imports). */
const SOURCE = /\.(tsx?|mts|cts|css)$/;
const KEEP = new Set(["next.config.ts", path.join("src", "lib", "moved-pages.ts"), path.join("knowledge", "next.config.ts")]);

/**
 * A release ships no sources: the builds (.next, knowledge/.next) are what runs. Out go the TypeScript and CSS, the build
 * tooling and the folders left empty; the plain JavaScript a bundle does run as it is (the drivers, the hosts, the MCP
 * scripts, the launcher) is minified.
 */
async function stripSources(dir) {
  step("Stripping the sources (a release runs from its builds)");
  for (const f of BUILD_ONLY) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
  const skip = (rel) => rel === "node_modules" || rel.endsWith(`${path.sep}node_modules`) || /(^|[\\/])\.next(-sync)?$/.test(rel);
  let removed = 0;
  const js = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const rel = path.relative(dir, p);
      if (e.isDirectory()) {
        if (skip(rel)) continue;
        walk(p);
        if (!fs.readdirSync(p).length) fs.rmdirSync(p);
      } else if (SOURCE.test(e.name) && !KEEP.has(rel)) {
        fs.rmSync(p);
        removed++;
      } else if (/\.(mjs|cjs|js)$/.test(e.name)) js.push(p);
    }
  };
  walk(dir);
  console.log(`${removed} source files removed`);
  // The builds' source maps hold the sources themselves (sourcesContent), and their types/ the routes as TypeScript.
  let maps = 0;
  for (const build of [".next", path.join("knowledge", ".next")]) {
    fs.rmSync(path.join(dir, build, "types"), { recursive: true, force: true });
    for (const f of fs.readdirSync(path.join(dir, build), { recursive: true })) {
      if (!f.endsWith(".map")) continue;
      fs.rmSync(path.join(dir, build, f));
      maps++;
    }
  }
  console.log(`${maps} source maps removed`);
  await minify(js);
}

/** Plain JavaScript, minified in place with esbuild (the checkout's — dev dependencies are pruned from the copy). */
async function minify(files) {
  const { transform } = await import("esbuild");
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const loader = "js";
    const format = f.endsWith(".cjs") ? "cjs" : f.endsWith(".mjs") ? "esm" : undefined;
    const out = await transform(src, { loader, format, minify: true, target: "node22", legalComments: "none" });
    fs.writeFileSync(f, out.code);
  }
  console.log(`${files.length} script files minified`);
}

/** The README next to the launcher: how to start it here, where the data is. */
function readme() {
  const title = `Zeff${version ? ` ${version}` : ""} (${target})`;
  const start = {
    win32: `Start Zeff.exe. It runs Zeff and its knowledge server and opens https://zeff in your browser.
The tray icon (bottom right; click it for the status window) has everything else: open Zeff,
start / stop / restart each server, their logs, "Start with Windows", and Quit.

The first start asks once to set up https://zeff (admin rights, Windows asks):
  - the hosts file gets "127.0.0.1 zeff knowledge.zeff"
  - Windows trusts Zeff's own certificate. It was made on this computer and its signing key
    was deleted right away, so it can't vouch for anything else.
Without admin rights Zeff runs on https://127.0.0.1:1337.`,
    darwin: `Move Zeff.app to Applications, then open it. The app isn't signed by an Apple developer
account, so macOS refuses the first time: open System Settings → Privacy & Security and click
"Open Anyway" next to Zeff — or, in Terminal, once:

  xattr -dr com.apple.quarantine /Applications/Zeff.app

Zeff lives in the menu bar (no Dock icon): open Zeff, the status window, start / stop / restart
each server, their logs, "Start at log in", and Quit. It runs Zeff and its knowledge server and
opens https://zeff in your browser.

The first start asks once to set up https://zeff:
  - the hosts file gets "127.0.0.1 zeff knowledge.zeff" (macOS asks for an admin password)
  - your login keychain trusts Zeff's own certificate (macOS asks for your password). It was
    made on this computer and its signing key was deleted right away, so it can't vouch for
    anything else.
Without that Zeff runs on https://127.0.0.1:1337. Firefox has its own certificates: set
security.enterprise_roots.enabled to true in about:config.`,
    linux: `Start ./zeff (needs a desktop session — Ubuntu 22.04 or newer). It runs Zeff and its
knowledge server, opens https://zeff in your browser and adds Zeff to the applications menu.
The tray icon has everything else: open Zeff, the status window, start / stop / restart each
server, their logs, "Start at log in", and Quit.

The first start asks once to set up https://zeff (pkexec asks for your password):
  - the hosts file gets "127.0.0.1 zeff knowledge.zeff"
  - the system trusts Zeff's own certificate. It was made on this computer and its signing key
    was deleted right away, so it can't vouch for anything else.
Chrome and Firefox read their own certificate database: for them install certutil once
(sudo apt install libnss3-tools) before the setup. Port 443 needs root on Linux, so Zeff is
https://zeff:1337. Without the setup: https://127.0.0.1:1337.

The launcher runs without Electron's sandbox unless chrome-sandbox belongs to root:
  sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox`,
  }[PLATFORM];
  const data = {
    win32: `Your data stays in app\\data and app\\knowledge\\data: keep those folders when you update
(replace everything else). Settings like JIRA_URL go in app\\.env.
Options (ports, host name, extra environment): zeff-launcher.json next to Zeff.exe, e.g.`,
    darwin: `Your data is in ~/Library/Application Support/Zeff — not in Zeff.app, so an update just
replaces Zeff.app. Settings like JIRA_URL go in a .env file there.
Options (ports, host name, extra environment): zeff-launcher.json in that folder, e.g.`,
    linux: `Your data is in ~/.local/share/zeff — not in this folder, so an update just replaces it.
Settings like JIRA_URL go in a .env file there.
Options (ports, host name, extra environment): zeff-launcher.json in that folder, e.g.`,
  }[PLATFORM];
  return `${title}
${"=".repeat(title.length)}

${start}

Addresses
  https://zeff, https://zeff:1337     Zeff
  https://knowledge.zeff              the knowledge server
  http://127.0.0.1:9333/api/mcp       Zeff's MCP endpoint for agents (unchanged)

${data}
  { "httpsPorts": [443, 1337], "zeffPort": 9333, "knowledgePort": 9555, "env": { } }
`;
}

/** The launcher: Electron's files (renamed for Zeff), the launcher code in resources/app, README.txt. */
async function packLauncher() {
  step("Launcher (Electron)");
  const electronDir = path.join(electronFrom, "node_modules", "electron");
  if (!fs.existsSync(electronDir)) npm(["ci", "--no-audit", "--no-fund"], electronFrom);
  const dist = path.join(electronDir, "dist");
  const electronExe = path.join(dist, { win32: "electron.exe", darwin: "Electron.app", linux: "electron" }[PLATFORM]);
  if (!fs.existsSync(electronExe)) run(process.execPath, [path.join(electronDir, "install.js")], { cwd: electronDir });
  const electronVersion = JSON.parse(fs.readFileSync(path.join(electronDir, "package.json"), "utf8")).version;

  if (MAC) packMac(dist);
  else {
    // Electron's files go next to app/ and runtime/ — replaced only for another Electron version
    // (a running Zeff.exe holds them; the launcher's code below can be swapped under it).
    const versionFile = (dir) => (fs.existsSync(path.join(dir, "version")) ? fs.readFileSync(path.join(dir, "version"), "utf8").trim() : null);
    const exe = path.join(out, WIN ? "Zeff.exe" : "zeff-launcher");
    if (fs.existsSync(exe) && versionFile(out) === versionFile(dist)) {
      fs.rmSync(code, { recursive: true, force: true });
    } else {
      for (const e of fs.readdirSync(out)) {
        if (!["app", "runtime", "zeff-launcher.json"].includes(e)) fs.rmSync(path.join(out, e), { recursive: true, force: true });
      }
      copyDir(dist, out, (rel) => rel === path.join("resources", "default_app.asar"));
      fs.renameSync(path.join(out, WIN ? "electron.exe" : "electron"), exe);
    }
    if (!WIN) {
      fs.copyFileSync(path.join(launcher, "zeff.sh"), path.join(out, "zeff"));
      fs.chmodSync(path.join(out, "zeff"), 0o755);
    }
  }

  for (const f of ["package.json", "main.js", "preload.js", "status.html", "status.js", "icon.ico", "icon.png", "lib", "ps"]) {
    fs.cpSync(path.join(launcher, f), path.join(code, f), { recursive: true });
  }
  // The launcher's own dependencies (the phone companion's: node-datachannel — native, its prebuilt binary for this
  // platform is a package of its own — and qrcode): the checkout's launcher/node_modules, without Electron and the dev ones.
  const launcherDeps = spawnSync(WIN ? "npm.cmd" : "npm", ["ls", "--omit=dev", "--all", "--parseable"], { cwd: electronFrom, encoding: "utf8", shell: true })
    .stdout.split(/\r?\n/)
    .filter((p) => p && path.resolve(p) !== path.resolve(electronFrom));
  if (!launcherDeps.some((p) => p.includes("node-datachannel"))) throw new Error("launcher/node_modules lacks node-datachannel — run npm ci in launcher/");
  for (const p of launcherDeps) copyDir(p, path.join(code, path.relative(electronFrom, p)));
  if (release) await minify(fs.readdirSync(code, { recursive: true }).filter((f) => /\.(js|cjs|mjs)$/.test(f) && !f.split(/[\\/]/).includes("node_modules")).map((f) => path.join(code, f)));
  console.log(`Electron ${electronVersion} → ${path.basename(out)}, launcher → ${path.relative(out, code)}`);

  fs.writeFileSync(path.join(top, "README.txt"), readme());
  if (MAC) signMac();
}

/** Zeff.app: Electron.app with Zeff's name, id and icon; the bundle (Contents/Resources/zeff) kept. */
function packMac(dist) {
  const keep = `${out}.bundle`;
  fs.rmSync(keep, { recursive: true, force: true });
  if (fs.existsSync(bundle)) fs.renameSync(bundle, keep);
  fs.rmSync(out, { recursive: true, force: true });
  copyDir(path.join(dist, "Electron.app"), out, (rel) => rel === path.join("Contents", "Resources", "default_app.asar"));
  if (fs.existsSync(keep)) fs.renameSync(keep, bundle);

  const plist = path.join(out, "Contents", "Info.plist");
  const set = (key, type, value) => run("plutil", ["-replace", key, `-${type}`, value, plist]);
  set("CFBundleName", "string", "Zeff");
  set("CFBundleDisplayName", "string", "Zeff");
  set("CFBundleIdentifier", "string", "de.zeff.launcher");
  set("LSUIElement", "bool", "true"); // menu bar only, no Dock icon
  if (version) set("CFBundleShortVersionString", "string", version.replace(/^v/, ""));

  // The icon: Electron's electron.icns (Info.plist points there), made from icon.png.
  const iconset = path.join(os.tmpdir(), "zeff.iconset");
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset);
  for (const size of [16, 32, 128, 256]) {
    for (const [scale, px] of [["", size], ["@2x", size * 2]]) {
      if (px > 256) continue;
      run("sips", ["-z", String(px), String(px), path.join(launcher, "icon.png"), "--out", path.join(iconset, `icon_${size}x${size}${scale}.png`)], { stdio: "ignore" });
    }
  }
  run("iconutil", ["-c", "icns", iconset, "-o", path.join(out, "Contents", "Resources", "electron.icns")]);
  fs.rmSync(iconset, { recursive: true, force: true });
}

/**
 * Ad-hoc signatures (no Apple developer account): every unsigned Mach-O in the bundle (native
 * modules; Node keeps its own), then Zeff.app itself — its Info.plist changed, and Apple Silicon
 * runs nothing unsigned.
 */
function signMac() {
  step("Signing Zeff.app (ad hoc)");
  const machO = (file) => {
    try {
      const fd = fs.openSync(file, "r");
      const b = Buffer.alloc(4);
      fs.readSync(fd, b, 0, 4, 0);
      fs.closeSync(fd);
      return ["cffaedfe", "cefaedfe", "cafebabe", "feedfacf", "feedface", "bebafeca"].includes(b.toString("hex"));
    } catch {
      return false;
    }
  };
  let n = 0;
  for (const e of fs.readdirSync(bundle, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const file = path.join(e.parentPath, e.name);
    if (fs.statSync(file).size < 4096 || !machO(file)) continue;
    if (spawnSync("codesign", ["--verify", file], { stdio: "ignore" }).status === 0) continue;
    run("codesign", ["--force", "--sign", "-", file]);
    n++;
  }
  console.log(`${n} native files signed`);
  run("codesign", ["--force", "--sign", "-", out]);
  run("codesign", ["--verify", "--strict", out]);
}

if (release) {
  checkWorkingTree();
  console.log(`Release ${version} (${exactTag ? `tag ${exactTag}, ` : "no tag on this commit, "}commit ${commit}) for ${target}`);
}
if (args.has("--launcher-only")) {
  // A bundle without app/ is fine: zeff-launcher.json's "appDir" can point it at a checkout.
  if (!fs.existsSync(bundle)) throw new Error(`${bundle} doesn't exist yet — run without --launcher-only first.`);
} else {
  await buildApp();
}
await packLauncher();

if (release) {
  // Nothing of this machine: no launcher options (they'd point at this checkout), no data, no secrets.
  fs.rmSync(staging, { recursive: true, force: true });
  const mine = ["zeff-launcher.json", path.join("app", "data"), path.join("app", "knowledge", "data"), path.join("app", ".env"), path.join("app", ".env.local")].filter((f) =>
    fs.existsSync(path.join(bundle, f)),
  );
  if (mine.length) throw new Error(`Not for a release: ${mine.join(", ")} in ${bundle}.`);
}

/** sha256 of a file, streamed (an archive is hundreds of MB). */
function sha256(file) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(8 * 1024 * 1024);
  try {
    for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0; ) hash.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

/** A release names no one: the builder's user name in any text file of the bundle (paths Next or a tool wrote) stops it. */
function noUserName(dir) {
  const user = os.userInfo().username;
  // (A container's or a CI runner's account names no one — and "root" is a word in many files.)
  if (!user || user.length < 3 || ["root", "runner", "user", "admin", "node", "build", "ubuntu"].includes(user.toLowerCase())) return;
  const needle = user.toLowerCase();
  const found = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules") walk(p);
      } else if (e.isFile() && fs.statSync(p).size < 5_000_000) {
        const b = fs.readFileSync(p);
        if (b.subarray(0, 8000).includes(0)) continue; // (a binary)
        if (b.toString("latin1").toLowerCase().includes(needle)) found.push(path.relative(dir, p));
      }
    }
  };
  walk(dir);
  if (found.length) throw new Error(`The bundle names the builder ("${user}") in:\n  ${found.slice(0, 20).join("\n  ")}`);
}

let archive = null;
if (args.has("--zip") || release) {
  if (release) {
    step("Checking for the builder's user name");
    noUserName(top);
  }
  step("Packing");
  const ext = PLATFORM === "linux" ? "tar.gz" : "zip";
  const name = release ? `Zeff-${version}-${target}.${ext}` : `Zeff.${ext}`;
  archive = path.join(root, "dist", ...(release ? ["release"] : []), name);
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  fs.rmSync(archive, { force: true });
  fs.rmSync(`${archive}.sha256`, { force: true });
  if (WIN) run(tarExe, ["-a", "-c", "-f", archive, "Zeff"], { cwd: path.dirname(top) });
  // ditto keeps Zeff.app's symlinks and signatures.
  else if (MAC) run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", top, archive]);
  else run(tarExe, ["-czf", archive, "Zeff"], { cwd: path.dirname(top) });
  console.log(`${archive} (${(fs.statSync(archive).size / 1048576).toFixed(0)} MB)`);
}

const size = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true, recursive: true }).reduce((s, e) => (e.isFile() ? s + fs.statSync(path.join(e.parentPath, e.name)).size : s), 0);
console.log(`\n✔ ${top} (${(size(top) / 1048576).toFixed(0)} MB)`);

if (release && archive) {
  // <archive>.sha256 in sha256sum's format: `sha256sum -c`, `shasum -a 256 -c`, or Get-FileHash to compare.
  const hash = sha256(archive);
  fs.writeFileSync(`${archive}.sha256`, `${hash}  ${path.basename(archive)}\n`);
  console.log(`\nRelease ${version}${exactTag ? "" : "  (no tag on this commit — git tag v1.2.3 for a named release)"}
  commit   ${commit}
  system   ${target}
  archive  ${archive}
  size     ${(fs.statSync(archive).size / 1048576).toFixed(1)} MB (${fs.statSync(archive).size} bytes)
  sha256   ${hash}
           → ${archive}.sha256`);

  // The build folder (about 1 GB of what was packed) isn't needed any more.
  if (!args.has("--keep-build")) fs.rmSync(releaseDir, { recursive: true, force: true, maxRetries: 5 });

  if (args.has("--no-check")) console.log("\n(--no-check: the archive was not tested — npm run release:check -- <archive> does.)");
  else {
    step("Checking the archive (scripts/smoke-release.mjs)");
    const r = spawnSync(process.execPath, [path.join(root, "scripts", "smoke-release.mjs"), archive], { stdio: "inherit" });
    if (r.status !== 0) {
      console.error(`\n✘ The release check failed — do not publish ${path.basename(archive)}.`);
      process.exit(r.status ?? 1);
    }
  }
}
