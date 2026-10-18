// Where things are and how they're wired: the optional zeff-launcher.json, plus the layout it
// runs in — the bundle (the launcher, runtime/node[.exe], app/) or a Zeff checkout (`npm start`
// in launcher/, Node from PATH).
//
// Data: a checkout and the Windows bundle keep it in <app>/data, as always. The macOS and Linux
// bundles can't — Zeff.app may run from a read-only place, and an update replaces the whole
// folder — so theirs is in the user's profile:
//   macOS  ~/Library/Application Support/Zeff
//   Linux  $XDG_DATA_HOME/zeff (~/.local/share/zeff)
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseEnv } = require("node:util");

const WIN = process.platform === "win32";
const NODE = WIN ? "node.exe" : "node";

const DEFAULTS = {
  /** Zeff's folder (package.json, .next, knowledge/). Relative to the bundle folder. */
  appDir: null,
  /** The node binary that runs the servers. */
  node: null,
  /** Zeff's data (databases, the launcher's state and logs). Default: see above. */
  dataDir: null,
  /** The name the hosts file maps to 127.0.0.1 — https://zeff. */
  host: "zeff",
  zeffPort: 9333,
  knowledgePort: 9555,
  /** Run the work host (scripts/work-host.mjs): Zeff's workers live there, so restarting Zeff's server (a deploy) doesn't cut them off. */
  workHost: true,
  workPort: 9334,
  /**
   * Run the sync host: a second Zeff server (ZEFF_ROLE=sync, from the build in .next-sync) that does the syncs, the
   * scheduler and the briefing, so a deploy restarts only the pages — a sync goes on. Zeff's server hands its work
   * to it while that build is there (npm run deploy makes it); else it does everything itself, as before.
   */
  syncHost: true,
  syncPort: 9336,
  /** Manage the knowledge server too (and route https://knowledge.<host> to it). */
  knowledge: true,
  /** HTTPS ports on 127.0.0.1. 443 is best effort — something else may hold it (Linux: root only). */
  httpsPorts: [443, 1337],
  /** Redirect http://<host> (port 80) to https. */
  httpRedirect: true,
  /**
   * Claude Code in a Docker container (docker/claude, scripts/claude-docker.mjs) — for a computer that cannot have the CLI. The launcher keeps
   * the container up as the "Claude" service and tells Zeff to run the CLI through it (CLAUDE_CLI). Your repos are mounted: the folders in
   * claudeMounts ("C:\Users\you\Documents=/host/documents;…"; none: your Documents folder).
   */
  claudeDocker: false,
  claudePort: 9335,
  claudeMounts: "",
  /** Run Zeff as `next dev` (hot reload) instead of `next start`. Also: --dev, or the tray toggle (kept in <data>/launcher/dev-mode). */
  dev: false,
  /** Start the servers with the launcher. */
  autostartServers: true,
  /** Extra environment for both servers. */
  env: {},
};

/** The per-user data folder of the macOS and Linux bundles. */
function userDataDir() {
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Zeff");
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "zeff");
}

const isZeffApp = (dir) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).name === "zeff";
  } catch {
    return false;
  }
};

function* ancestors(dir) {
  for (let d = path.resolve(dir); ; ) {
    yield d;
    const up = path.dirname(d);
    if (up === d) return;
    d = up;
  }
}

function findApp(starts) {
  for (const s of starts)
    for (const d of ancestors(s)) {
      if (isZeffApp(path.join(d, "app"))) return path.join(d, "app");
      if (isZeffApp(d)) return d;
    }
  return null;
}

function findNode(dirs) {
  for (const d of dirs) {
    const p = path.join(d, "runtime", NODE);
    if (fs.existsSync(p)) return p;
  }
  for (const d of (process.env.PATH ?? "").split(path.delimiter)) {
    const p = path.join(d, NODE);
    if (d && fs.existsSync(p)) return p;
  }
  return null;
}

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch (e) {
    throw new Error(`${file}: ${e.message}`);
  }
};

/**
 * { cfg, paths } — throws with a message meant for the user.
 * bundleDir: where the bundle's app/ and runtime/ are (next to Zeff.exe; in Zeff.app, Contents/Resources/zeff).
 */
function load({ bundleDir, codeDir, configFile }) {
  const file = configFile ?? [path.join(bundleDir, "zeff-launcher.json"), path.join(userDataDir(), "zeff-launcher.json")].find((f) => fs.existsSync(f));
  const user = file && fs.existsSync(file) ? readJson(file) : {};
  const cfg = { ...DEFAULTS, ...user, env: { ...DEFAULTS.env, ...user.env } };
  cfg.knowledgeHost = `knowledge.${cfg.host}`;
  /** Names the hosts file maps to 127.0.0.1. */
  cfg.hostsNames = cfg.knowledge ? [cfg.host, cfg.knowledgeHost] : [cfg.host];
  /** Names the certificate covers: those, their .localhost twins (no hosts entry needed) and localhost. */
  cfg.certNames = [cfg.host, cfg.knowledgeHost].flatMap((h) => [h, `${h}.localhost`]).concat("localhost");

  const app = cfg.appDir ? path.resolve(bundleDir, cfg.appDir) : findApp([bundleDir, codeDir]);
  if (!app)
    throw new Error(
      "Zeff's app folder wasn't found: expected app/ in the bundle, or the launcher inside a Zeff checkout. Set \"appDir\" in zeff-launcher.json.",
    );
  if (!isZeffApp(app)) throw new Error(`${app} is not a Zeff app folder (no package.json named "zeff").`);

  const node = cfg.node ? path.resolve(bundleDir, cfg.node) : findNode([bundleDir, path.dirname(app)]);
  if (!node || !fs.existsSync(node)) throw new Error(`${NODE} wasn't found: expected runtime/${NODE} in the bundle, or Node on PATH.`);

  const bundled = path.resolve(app) === path.resolve(bundleDir, "app");
  const data = cfg.dataDir
    ? path.resolve(bundleDir, cfg.dataDir)
    : cfg.env.DATABASE_PATH
      ? path.dirname(path.resolve(app, cfg.env.DATABASE_PATH))
      : bundled && !WIN
        ? userDataDir()
        : path.join(app, "data");

  // <data>/.env: settings like JIRA_URL where the app folder can't take them (Zeff.app).
  const envFile = path.join(data, ".env");
  if (fs.existsSync(envFile)) cfg.env = { ...parseEnv(fs.readFileSync(envFile, "utf8")), ...cfg.env };

  const paths = { bundleDir, configFile: file ?? null, app, node, data, state: path.join(data, "launcher"), logs: path.join(data, "logs") };
  fs.mkdirSync(paths.state, { recursive: true });
  fs.mkdirSync(paths.logs, { recursive: true });
  return { cfg, paths };
}

module.exports = { load, userDataDir };
