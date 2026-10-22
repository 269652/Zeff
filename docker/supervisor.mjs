#!/usr/bin/env node
/**
 * The Zeff stack in a container ("zeff-stack"): what the launcher does for these three on the host, as one process that keeps them up —
 *
 *   web   next start, the pages (ZEFF_ROLE=web), port 9333
 *   sync  next start from its own build folder (.next-sync, ZEFF_ROLE=sync), 9336 — syncs, scheduler, briefing
 *   work  scripts/work-host.mjs, 9334 — the workers (Claude / Copilot CLI runs) are its children
 *
 * They are in ONE container because they share the database (data/zeff.db): two worlds (a service on Windows, another in a container)
 * writing the same SQLite file do not share file locks. A service that ends is started again after a pause; SIGTERM / SIGINT stop them
 * all. The tokens the services share are kept in data/docker/tokens.json. Plain Node, no dependencies.
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = process.env.ZEFF_APP_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = process.env.ZEFF_DATA_DIR || path.join(APP, "data");
const NEXT = path.join(APP, "node_modules", "next", "dist", "bin", "next");
const PORTS = { web: Number(process.env.ZEFF_PORT) || 9333, work: 9334, sync: 9336 };

const log = (m) => console.log(`${new Date().toISOString()} [supervisor] ${m}`);

/**
 * The tokens the services share (the work host and the sync host each talk only to Zeff's server).
 * @returns {{ work: string, sync: string }}
 */
export function tokens(dataDir = DATA) {
  const file = path.join(dataDir, "docker", "tokens.json");
  /** @type {Record<string, string>} */
  let t = {};
  try {
    t = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // first start
  }
  let changed = false;
  for (const k of ["work", "sync"]) {
    if (typeof t[k] !== "string" || t[k].length < 24) {
      t[k] = crypto.randomBytes(24).toString("hex");
      changed = true;
    }
  }
  if (changed) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(t), { mode: 0o600 });
  }
  return { work: t.work, sync: t.sync };
}

/**
 * The services and how each starts. `bind`: the address the pages listen on inside the container (0.0.0.0: the published port reaches it;
 * ZEFF_BIND=127.0.0.1 on a server whose container shares the host's network — only the edge in front of it, Caddy, reaches them).
 * @typedef {{ name: string, args: string[], env: Record<string, string | undefined> }} Service
 * @param {{ app?: string, data?: string, tok?: { work: string, sync: string }, bind?: string }} [o]
 * @returns {Service[]}
 */
export function services({ app = APP, data = DATA, tok = tokens(DATA), bind = process.env.ZEFF_BIND || "0.0.0.0" } = {}) {
  const env = {
    ...process.env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    ZEFF_URL: `http://127.0.0.1:${PORTS.web}`,
    ZEFF_WORK_HOST: `http://127.0.0.1:${PORTS.work}`,
    ZEFF_WORK_PORT: String(PORTS.work),
    ZEFF_WORK_TOKEN: tok.work,
    ZEFF_WORK_STATE: path.join(data, "docker", "work-host.json"),
  };
  const next = (port, host) => [NEXT, "start", "-H", host, "-p", String(port)];
  return [
    { name: "web", args: next(PORTS.web, bind), env: { ...env, ZEFF_ROLE: "web", ZEFF_SYNC_HOST: `http://127.0.0.1:${PORTS.sync}`, ZEFF_SYNC_TOKEN: tok.sync } },
    { name: "sync", args: next(PORTS.sync, "127.0.0.1"), env: { ...env, ZEFF_ROLE: "sync", ZEFF_SYNC_TOKEN: tok.sync, ZEFF_DIST_DIR: ".next-sync" } },
    { name: "work", args: [path.join(app, "scripts", "work-host.mjs")], env },
  ];
}

function run() {
  const running = new Map();
  let stopping = false;
  const start = (svc) => {
    if (stopping) return;
    log(`${svc.name}: starting`);
    const child = spawn(process.execPath, svc.args, { cwd: APP, env: svc.env, stdio: "inherit" });
    running.set(svc.name, child);
    child.on("exit", (code, signal) => {
      running.delete(svc.name);
      if (stopping) return;
      log(`${svc.name}: ended (${signal ?? code}) — again in 5 s`);
      setTimeout(() => start(svc), 5000);
    });
  };
  for (const svc of services()) start(svc);
  const stop = () => {
    stopping = true;
    log("stopping");
    for (const child of running.values()) child.kill("SIGTERM");
    setTimeout(() => process.exit(0), 8000).unref();
    const t = setInterval(() => running.size === 0 && process.exit(0), 200);
    t.unref?.();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
