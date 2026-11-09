// Updates for Zeff, found and done by the launcher — the way Zeff came onto this computer:
//
//   git      a checkout (app/.git) whose branch follows a remote branch: `git fetch`, and an update when the branch is only
//            behind it (no commits of its own there — never a merge). The update: `git merge --ff-only`, the packages
//            installed again when their lockfile changed, then a build (production) or just a restart (dev mode).
//            A branch without an upstream, or with local changes or commits of its own: no offer (said why).
//   release  the bundle (Zeff.exe + app/ + runtime/): the newest release on GitHub (updateRepo), its archive for this
//            system downloaded, checked against its .sha256, unpacked beside; then the launcher quits and a small
//            script swaps it in — app/data and app/.env kept — and starts Zeff again.
//   none     neither (macOS: no releases yet; an app folder set by hand).
//
// Pure parts (versions, names, the plan) are exported for tests; the side effects take their tools as arguments.
const { execFile, spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");

const WIN = process.platform === "win32";

/** "v0.1.10" → [0,1,10] (null: not a version). */
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? "").trim());
  return m ? m.slice(1, 4).map(Number) : null;
}

/** Whether `latest` is newer than `current` (unreadable: no). */
function isNewer(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** This system's release archive name, as scripts/dist.mjs names it (null: no releases for it). */
function assetName(tag, platform = process.platform, arch = process.arch) {
  const os = { win32: "windows", linux: "linux" }[platform];
  if (!os) return null;
  return `Zeff-${tag}-${os}-${arch}.${platform === "linux" ? "tar.gz" : "zip"}`;
}

/** How Zeff is installed here: "git" (a checkout), "release" (the bundle's app/), or "none". */
function installKind({ app, bundleDir }, platform = process.platform) {
  if (fs.existsSync(path.join(app, ".git"))) return "git";
  if (platform !== "darwin" && path.resolve(app) === path.resolve(bundleDir, "app")) return "release";
  return "none";
}

/**
 * What a checkout's state means: an update only when the branch is behind its upstream and has nothing of its own
 * (a fast-forward), and nothing changed by hand stands in the way.
 */
function gitVerdict({ upstream, behind, ahead, dirty }) {
  if (!upstream) return { available: false, note: "This branch follows no remote branch — no updates to look for." };
  if (ahead > 0 && behind > 0) return { available: false, note: `This branch and ${upstream} went apart (${ahead} own commits) — update it by hand.` };
  if (behind === 0) return { available: false, note: null };
  if (dirty) return { available: true, blocked: `There are changes here that aren't committed — commit or put them aside first.`, note: null };
  return { available: true, note: null };
}

const run = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { windowsHide: true, timeout: opts.timeout ?? 120000, maxBuffer: 32 * 1024 * 1024, ...opts }, (e, stdout, stderr) =>
      e ? reject(new Error(`${cmd} ${args.join(" ")}: ${(stderr || e.message).trim().slice(0, 400)}`)) : resolve(String(stdout).trim()),
    ),
  );

/** GET over https (redirects followed) — the body as a Buffer, or into `file`. */
function get(url, { file, headers = {}, hops = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "Zeff-Launcher", Accept: "application/vnd.github+json", ...headers }, timeout: 60000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 5) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).toString(), { file, headers, hops: hops + 1 }));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`${url}: HTTP ${res.statusCode}`));
      }
      if (file) {
        const out = fs.createWriteStream(file);
        res.pipe(out);
        out.on("finish", () => out.close(() => resolve(file)));
        out.on("error", reject);
        res.on("error", reject);
      } else {
        const parts = [];
        res.on("data", (c) => parts.push(c));
        res.on("end", () => resolve(Buffer.concat(parts)));
        res.on("error", reject);
      }
    });
    req.on("timeout", () => req.destroy(new Error(`${url}: timed out`)));
    req.on("error", reject);
  });
}

const sha256 = (file) =>
  new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file)
      .on("data", (c) => h.update(c))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });

const appVersion = (app) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(app, "package.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
};

/** Git without a terminal: never waits on a password or host key prompt (fails instead). */
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || "ssh -o BatchMode=yes" };

/** A checkout's state: its branch, upstream, how far behind/ahead (after a fetch), local changes. */
async function gitState(app) {
  const git = (...a) => run("git", a, { cwd: app, env: GIT_ENV });
  const branch = await git("rev-parse", "--abbrev-ref", "HEAD");
  let upstream = null;
  try {
    upstream = await git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}");
  } catch {
    return { branch, upstream: null, behind: 0, ahead: 0, dirty: false, head: await git("rev-parse", "--short", "HEAD") };
  }
  const remote = upstream.split("/")[0];
  await git("fetch", "--quiet", remote).catch((e) => {
    throw new Error(`Couldn't reach ${remote}: ${e.message}`);
  });
  const [ahead, behind] = (await git("rev-list", "--left-right", "--count", "HEAD...@{u}")).split(/\s+/).map(Number);
  const dirty = (await git("status", "--porcelain", "--untracked-files=no")).length > 0;
  return { branch, upstream, behind, ahead, dirty, head: await git("rev-parse", "--short", "HEAD"), latest: await git("rev-parse", "--short", "@{u}") };
}

/** The newest release (repo "owner/name"): its tag and this system's archive (+ .sha256) — null when there's none for it. */
async function latestRelease(repo) {
  const r = JSON.parse((await get(`https://api.github.com/repos/${repo}/releases/latest`)).toString("utf8"));
  const name = assetName(r.tag_name);
  const asset = name && r.assets?.find((a) => a.name === name);
  const sum = name && r.assets?.find((a) => a.name === `${name}.sha256`);
  return { tag: r.tag_name, url: r.html_url, asset: asset ? { name, url: asset.browser_download_url, size: asset.size } : null, sha256Url: sum?.browser_download_url ?? null };
}

/**
 * Looks for an update — { kind, available, current, latest, note, blocked?, release? }.
 */
async function check({ app, bundleDir, repo }) {
  const kind = installKind({ app, bundleDir });
  if (kind === "git") {
    const s = await gitState(app);
    const v = gitVerdict(s);
    return { kind, current: `${s.branch} @ ${s.head}`, latest: s.upstream ? `${s.upstream} @ ${s.latest}` : null, behind: s.behind, ...v };
  }
  if (kind === "release") {
    const current = appVersion(app);
    const r = await latestRelease(repo);
    const newer = isNewer(r.tag, current);
    if (newer && !r.asset) return { kind, current: `v${current}`, latest: r.tag, available: false, note: `${r.tag} has no archive for this system yet.` };
    return { kind, current: `v${current}`, latest: r.tag, available: newer, note: null, release: newer ? r : undefined };
  }
  return { kind, available: false, current: appVersion(app) ? `v${appVersion(app)}` : null, latest: null, note: "Zeff wasn't installed from git or a release here — no updates to look for." };
}

/**
 * A checkout brought up to its upstream (fast-forward only), packages installed when their lockfile changed. Returns
 * what changed: { from, to, files, launcher (its code changed: restart the launcher) }.
 */
async function updateGit(app, { say = () => {} } = {}) {
  const git = (...a) => run("git", a, { cwd: app, env: GIT_ENV, timeout: 600000 });
  const before = await git("rev-parse", "HEAD");
  say("Taking the new commits …");
  await git("merge", "--ff-only", "@{u}");
  const after = await git("rev-parse", "HEAD");
  const changed = before === after ? [] : (await git("diff", "--name-only", before, after)).split(/\r?\n/).filter(Boolean);
  const npm = WIN ? "npm.cmd" : "npm";
  if (changed.includes("package-lock.json")) {
    say("Installing Zeff's packages …");
    await run(npm, ["ci", "--no-audit", "--no-fund"], { cwd: app, timeout: 1800000, shell: WIN });
  }
  if (changed.includes("knowledge/package-lock.json") && fs.existsSync(path.join(app, "knowledge", "package.json"))) {
    say("Installing the knowledge server's packages …");
    await run(npm, ["ci", "--no-audit", "--no-fund"], { cwd: path.join(app, "knowledge"), timeout: 1800000, shell: WIN });
  }
  if (changed.includes("launcher/package-lock.json")) {
    say("Installing the launcher's packages …");
    await run(npm, ["ci", "--no-audit", "--no-fund"], { cwd: path.join(app, "launcher"), timeout: 1800000, shell: WIN });
  }
  return { from: before.slice(0, 8), to: after.slice(0, 8), files: changed.length, launcher: changed.some((f) => f.startsWith("launcher/")) };
}

/**
 * A release downloaded, checked and unpacked beside the bundle (<bundle>/.update — not under app/, which the swap moves;
 * the Windows bundle keeps its data in app/data) — the folder holding the new Zeff/ bundle.
 */
const updateDir = (bundleDir) => path.join(bundleDir, ".update");
async function downloadRelease(release, bundleDir, { say = () => {} } = {}) {
  const dir = updateDir(bundleDir);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, release.asset.name);
  say(`Downloading ${release.tag} (${Math.round((release.asset.size ?? 0) / 1048576)} MB) …`);
  await get(release.asset.url, { file, headers: { Accept: "application/octet-stream" } });
  if (release.sha256Url) {
    const want = (await get(release.sha256Url)).toString("utf8").trim().split(/\s+/)[0].toLowerCase();
    const have = await sha256(file);
    if (want !== have) throw new Error(`The download doesn't match its checksum (${have.slice(0, 12)} ≠ ${want.slice(0, 12)}) — not installed.`);
  }
  say("Unpacking …");
  const out = path.join(dir, "unpacked");
  fs.mkdirSync(out);
  // Windows' own bsdtar unpacks zips (not Git's tar, which may come first on PATH).
  const tar = WIN ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  await run(tar, ["-xf", file, "-C", out], { timeout: 1800000 });
  fs.rmSync(file, { force: true });
  const bundle = path.join(out, "Zeff");
  if (!fs.existsSync(path.join(bundle, "app", "package.json"))) throw new Error("The archive has no Zeff/app in it — not installed.");
  return bundle;
}

/** The script that swaps a new bundle in once the launcher has quit — and starts Zeff again (rolls back if app/ can't move). */
function swapScript({ pid, bundleDir, newBundle, restart, logFile }) {
  if (WIN) {
    const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
    return `$ErrorActionPreference = 'Stop'
$log = ${q(logFile)}
function Say($m) { Add-Content -Path $log -Value ("$(Get-Date -Format s) " + $m) }
$bundle = ${q(bundleDir)}; $new = ${q(newBundle)}
$app = Join-Path $bundle 'app'; $old = Join-Path $bundle 'app.old'
try { Wait-Process -Id ${Number(pid)} -Timeout 180 -ErrorAction SilentlyContinue } catch {}
Start-Sleep -Seconds 3
try {
  if (Test-Path $old) { Remove-Item $old -Recurse -Force }
  $moved = $false
  for ($i = 0; $i -lt 20 -and -not $moved; $i++) { try { Rename-Item $app 'app.old'; $moved = $true } catch { Start-Sleep -Seconds 3 } }
  if (-not $moved) { throw 'app\\ is still in use' }
  Move-Item (Join-Path $new 'app') $app
  foreach ($keep in @('data', '.env')) { $p = Join-Path $old $keep; if (Test-Path $p) { Move-Item $p (Join-Path $app $keep) -Force } }
  robocopy $new $bundle /E /R:5 /W:2 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { Say "robocopy: $LASTEXITCODE" }
  Say 'updated'
} catch {
  Say ("update failed: " + $_)
  if (-not (Test-Path (Join-Path $app 'package.json')) -and (Test-Path $old)) {
    if (Test-Path $app) { Remove-Item $app -Recurse -Force }
    Rename-Item $old 'app'
    Say 'rolled back'
  }
}
Start-Process -FilePath ${q(restart)}
`;
  }
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  return `#!/bin/sh
log=${q(logFile)}; bundle=${q(bundleDir)}; new=${q(newBundle)}
say() { echo "$(date -Iseconds) $1" >> "$log"; }
while kill -0 ${Number(pid)} 2>/dev/null; do sleep 1; done
sleep 3
rm -rf "$bundle/app.old"
if mv "$bundle/app" "$bundle/app.old" && mv "$new/app" "$bundle/app"; then
  for k in data .env; do [ -e "$bundle/app.old/$k" ] && mv "$bundle/app.old/$k" "$bundle/app/$k"; done
  cp -a "$new/." "$bundle/" && say updated || say "copy failed"
else
  say "update failed"; [ -d "$bundle/app.old" ] && [ ! -f "$bundle/app/package.json" ] && rm -rf "$bundle/app" && mv "$bundle/app.old" "$bundle/app" && say "rolled back"
fi
nohup ${q(restart)} >/dev/null 2>&1 &
`;
}

/** Starts the swap script, detached (it waits for this process to end). */
function startSwap(opts) {
  const file = path.join(updateDir(opts.bundleDir), WIN ? "swap.ps1" : "swap.sh");
  fs.writeFileSync(file, swapScript(opts), { mode: 0o755 });
  const child = WIN
    ? spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", file], { detached: true, stdio: "ignore", windowsHide: true })
    : spawn("/bin/sh", [file], { detached: true, stdio: "ignore" });
  child.unref();
}

/** What an earlier update left behind (app.old, the unpacked bundle) — removed in the background. */
function cleanUp({ bundleDir }) {
  for (const p of [path.join(bundleDir, "app.old"), updateDir(bundleDir)])
    if (fs.existsSync(p)) fs.promises.rm(p, { recursive: true, force: true }).catch(() => {});
}

module.exports = { parseVersion, isNewer, assetName, installKind, gitVerdict, swapScript, check, updateGit, downloadRelease, startSwap, cleanUp, appVersion };
