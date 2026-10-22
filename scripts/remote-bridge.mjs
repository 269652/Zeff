#!/usr/bin/env node
/**
 * The bridge to a Zeff on a server: WhatsApp Web (the automation browser) and Signal Desktop stay on THIS computer, Zeff on the
 * server drives them through it.
 *
 *   node scripts/remote-bridge.mjs
 *
 * It starts the browser bridge (scripts/chrome-bridge.mjs — a proxy per debug port and the control server) on 127.0.0.1 only, and
 * keeps an SSH tunnel to the server up that makes those same ports listen on the server's 127.0.0.1 (ssh -R). Zeff on the server
 * (ZEFF_CDP_BASE=http://127.0.0.1, ZEFF_BRIDGE_TOKEN = this computer's token) reaches them there. Nothing listens on this computer's
 * network, and the server gets in only with the token. A dropped tunnel is built again.
 *
 * data/remote.json: { "host": "1.2.3.4", "user": "zeff-bridge", "key": "C:\\…\\bridge_key" }  — the key may only forward ports
 * (docker/server/README.md).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONTROL_PORT, OFFSET, bridgeToken, debugPorts, launchBrowser, startBridge } from "./chrome-bridge.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.ZEFF_DATA_DIR || path.join(here, "..", "data");
const log = (m) => console.log(`${new Date().toISOString()} [remote-bridge] ${m}`);

/**
 * The ssh arguments for the tunnel: each local port listens on the server's loopback under the same number. Pure.
 * @param {{ host: string, user: string, key: string, ports: number[], knownHosts?: string }} o
 */
export function tunnelArgs({ host, user, key, ports, knownHosts }) {
  return [
    "-N",
    "-i",
    key,
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    ...(knownHosts ? ["-o", `UserKnownHostsFile=${knownHosts}`] : []),
    ...ports.flatMap((p) => ["-R", `127.0.0.1:${p}:127.0.0.1:${p}`]),
    `${user}@${host}`,
  ];
}

async function main() {
  const cfg = JSON.parse(fs.readFileSync(path.join(DATA, "remote.json"), "utf8"));
  if (!cfg.host || !cfg.user || !cfg.key) throw new Error(`data/remote.json needs host, user and key`);
  const token = bridgeToken(DATA);
  const debug = debugPorts(DATA);
  const bridge = await startBridge({ token, ports: debug, host: "127.0.0.1", launch: async ({ port, urls }) => launchBrowser({ port, urls }) });
  const ports = [CONTROL_PORT, ...debug.map((p) => p + OFFSET)];
  log(`bridge on 127.0.0.1: ${ports.join(", ")} — tunnel to ${cfg.user}@${cfg.host}`);
  let child = null;
  let stopping = false;
  const up = () => {
    if (stopping) return;
    const started = Date.now();
    child = spawn("ssh", tunnelArgs({ ...cfg, ports, knownHosts: path.join(DATA, "remote-known-hosts") }), { stdio: ["ignore", "inherit", "inherit"], windowsHide: true });
    log("tunnel up");
    child.on("exit", (code) => {
      child = null;
      if (stopping) return;
      // Quick failures (no network, the server restarting): wait longer before the next try.
      const wait = Date.now() - started < 10_000 ? 30_000 : 3_000;
      log(`tunnel ended (${code}) — again in ${wait / 1000} s`);
      setTimeout(up, wait);
    });
  };
  up();
  const stop = () => {
    stopping = true;
    child?.kill();
    void bridge.close().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`[remote-bridge] ${e?.message ?? e}`);
    process.exit(1);
  });
}
