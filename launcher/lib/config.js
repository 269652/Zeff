// Where things are and how they're wired: the optional zeff-launcher.json next to Zeff.exe, plus
// the layout it runs in — the bundle (Zeff.exe, runtime\node.exe, app\) or a Zeff checkout
// (`npm start` in launcher/, Node from PATH).
const fs = require("node:fs");
const path = require("node:path");

const DEFAULTS = {
  /** Zeff's folder (package.json, .next, knowledge\). Relative to Zeff.exe. */
  appDir: null,
  /** node.exe that runs the servers. */
  node: null,
  /** The name the hosts file maps to 127.0.0.1 — https://zeff. */
  host: "zeff",
  zeffPort: 9333,
  knowledgePort: 9555,
  /** Manage the knowledge server too (and route https://knowledge.<host> to it). */
  knowledge: true,
  /** HTTPS ports on 127.0.0.1. 443 is best effort — something else may hold it. */
  httpsPorts: [443, 1337],
  /** Redirect http://<host> (port 80) to https. */
  httpRedirect: true,
  /** Start the servers with the launcher. */
  autostartServers: true,
  /** Extra environment for both servers. */
  env: {},
};

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
    const p = path.join(d, "runtime", "node.exe");
    if (fs.existsSync(p)) return p;
  }
  for (const d of (process.env.PATH ?? "").split(path.delimiter)) {
    const p = path.join(d, "node.exe");
    if (d && fs.existsSync(p)) return p;
  }
  return null;
}

/** { cfg, paths } — throws with a message meant for the user. */
function load({ exeDir, codeDir, configFile }) {
  const file = configFile ?? path.join(exeDir, "zeff-launcher.json");
  let user = {};
  if (fs.existsSync(file)) {
    try {
      user = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
    } catch (e) {
      throw new Error(`${file}: ${e.message}`);
    }
  }
  const cfg = { ...DEFAULTS, ...user, env: { ...DEFAULTS.env, ...user.env } };
  cfg.knowledgeHost = `knowledge.${cfg.host}`;
  /** Names the hosts file maps to 127.0.0.1. */
  cfg.hostsNames = cfg.knowledge ? [cfg.host, cfg.knowledgeHost] : [cfg.host];
  /** Names the certificate covers: those, their .localhost twins (no hosts entry needed) and localhost. */
  cfg.certNames = [cfg.host, cfg.knowledgeHost].flatMap((h) => [h, `${h}.localhost`]).concat("localhost");

  const app = cfg.appDir ? path.resolve(exeDir, cfg.appDir) : findApp([exeDir, codeDir]);
  if (!app)
    throw new Error(
      "Zeff's app folder wasn't found: expected app\\ next to Zeff.exe, or the launcher inside a Zeff checkout. Set \"appDir\" in zeff-launcher.json.",
    );
  if (!isZeffApp(app)) throw new Error(`${app} is not a Zeff app folder (no package.json named "zeff").`);

  const node = cfg.node ? path.resolve(exeDir, cfg.node) : findNode([exeDir, path.dirname(app)]);
  if (!node || !fs.existsSync(node)) throw new Error("node.exe wasn't found: expected runtime\\node.exe next to Zeff.exe, or Node on PATH.");

  const paths = { exeDir, app, node, state: path.join(app, "data", "launcher"), logs: path.join(app, "data", "logs") };
  fs.mkdirSync(paths.state, { recursive: true });
  fs.mkdirSync(paths.logs, { recursive: true });
  return { cfg, paths };
}

module.exports = { load };
