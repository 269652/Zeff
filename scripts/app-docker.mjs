#!/usr/bin/env node
/**
 * Zeff's own servers in a container, started from the host (by the launcher, or by hand):
 *
 *   stack      "zeff-stack": the pages (9333), the sync host and the work host — ONE container, they share the database
 *   knowledge  "zeff-knowledge[-<account>]": a knowledge server (9555 …), its own data folder
 *
 *   app-docker.mjs --build                                       the image zeff-app:local (docker/app/Dockerfile — a long build)
 *   app-docker.mjs --serve stack                                 the container up and watched (the launcher's service)
 *   app-docker.mjs --serve knowledge <account> <port> <dataDir>
 *   app-docker.mjs --down stack | knowledge [<account>] | all    the container(s) removed
 *   app-docker.mjs --status                                      { image, containers }
 *
 * The container is told what a container cannot see: the automation browser on the host (scripts/chrome-bridge.mjs), your security key
 * (watched on the host), the host's folders by their mounted paths (ZEFF_PATH_MAP, from ZEFF_DOCKER_MOUNTS / ZEFF_CLAUDE_MOUNTS). The
 * CLIs' sign-ins are the volume zeff-claude-home — the same one the AI-tools container (claude-docker.mjs) uses.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bridgeToken } from "./chrome-bridge.mjs";
import { dataDirOf, parseMounts } from "./claude-docker.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
export const IMAGE = "zeff-app:local";

/** The names: the stack's container and a knowledge server's (the first account's is plain "zeff-knowledge"). */
export const containerName = (kind, account = "default") => (kind === "stack" ? "zeff-stack" : account === "default" ? "zeff-knowledge" : `zeff-knowledge-${account}`);

/**
 * The folders of the host the servers see: ZEFF_DOCKER_MOUNTS, else ZEFF_CLAUDE_MOUNTS, else your Documents folder.
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [home]
 */
export function userMounts(env = process.env, home = os.homedir()) {
  const own = parseMounts(env.ZEFF_DOCKER_MOUNTS || env.ZEFF_CLAUDE_MOUNTS);
  return own.length ? own : [{ host: path.join(home, "Documents"), local: "/host/documents" }];
}

/** ZEFF_PATH_MAP for the container: host=container;… (Windows hosts: the repos are kept as C:\… paths). */
export const pathMapOf = (mounts) => mounts.map((m) => `${m.host}=${m.local}`).join(";");

/**
 * The docker arguments that start a container of Zeff's: the stack, or a knowledge server. Pure.
 * @param {{ kind: "stack" | "knowledge", account?: string, port?: number, dataDir: string, knowledgeDir?: string, mounts: { host: string, local: string }[], token: string, name?: string, image?: string, home?: string, env?: Record<string, string>, memory?: string }} o
 * @returns {string[]}
 */
export function appRunArgs({ kind, account = "default", port, dataDir, knowledgeDir, mounts, token, name, image = IMAGE, home = "zeff-claude-home", env = {}, memory }) {
  const container = name ?? containerName(kind, account);
  const published = kind === "stack" ? 9333 : port;
  if (!published) throw new Error("a knowledge server needs its port");
  const label = crypto.createHash("sha1").update(JSON.stringify({ kind, account, published, dataDir, knowledgeDir, mounts, image, home, env })).digest("hex").slice(0, 16);
  const vars = {
    ZEFF_CDP_BASE: "http://host.docker.internal",
    ZEFF_BRIDGE_TOKEN: token,
    ZEFF_PATH_MAP: pathMapOf(mounts),
    ZEFF_LOCK_WATCH: "host",
    KNOWLEDGE_URL: "http://host.docker.internal:9555",
    ...(kind === "knowledge" ? { KNOWLEDGE_ACCOUNT: account, ZEFF_URL: "http://host.docker.internal:9333", KNOWLEDGE_DATA_DIR: "/knowledge-data", PORT: String(port) } : {}),
    ...env,
  };
  return [
    "run",
    "-d",
    "--restart",
    "unless-stopped",
    "--init",
    "--name",
    container,
    "--label",
    `zeff.service=${kind}`,
    "--label",
    `zeff.config=${label}`,
    "--add-host",
    "host.docker.internal:host-gateway",
    "--security-opt",
    "no-new-privileges",
    ...(memory ? ["--memory", memory] : []),
    "-p",
    `127.0.0.1:${published}:${published}`,
    "-v",
    `${home}:/home/node`,
    ...(kind === "stack" ? ["-v", `${dataDir}:/app/data`] : ["-v", `${knowledgeDir ?? path.join(dataDir, "knowledge")}:/knowledge-data`]),
    ...mounts.flatMap((m) => ["-v", `${m.host}:${m.local}`]),
    ...Object.entries(vars).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    image,
    ...(kind === "knowledge" ? ["node", "node_modules/next/dist/bin/next", "start", "knowledge", "-H", "0.0.0.0", "-p", String(port)] : []),
  ];
}

// ---------------------------------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------------------------------

const docker = (args, opts = {}) => spawnSync("docker", args, { encoding: "utf8", windowsHide: true, ...opts });
const imageExists = () => docker(["image", "inspect", IMAGE]).status === 0;
const running = (name) => docker(["inspect", "-f", "{{.State.Running}}", name]).stdout?.trim() === "true";

export function build() {
  const r = spawnSync("docker", ["build", "-t", IMAGE, "-f", path.join(ROOT, "docker", "app", "Dockerfile"), ROOT], { stdio: "inherit", windowsHide: true });
  return r.status ?? 1;
}

/** The container up with the current settings (a changed setting recreates it); the image built first when it is missing. */
function ensureUp(spec) {
  if (!imageExists()) {
    process.stderr.write(`[app-docker] the image ${IMAGE} is missing — building it (docker/app/Dockerfile; a long build) …\n`);
    if (build() !== 0) throw new Error("the image could not be built");
  }
  const args = appRunArgs(spec);
  const name = args[args.indexOf("--name") + 1];
  const want = args.find((a) => a.startsWith("zeff.config="))?.slice(12);
  const have = docker(["inspect", "-f", '{{index .Config.Labels "zeff.config"}}', name]).stdout?.trim();
  if (running(name) && have === want) return name;
  docker(["rm", "-f", name]);
  const r = docker(args);
  if (r.status !== 0) throw new Error(`docker run failed: ${String(r.stderr).trim()}`);
  return name;
}

function specFrom(kind, rest, env = process.env) {
  const dataDir = dataDirOf(env);
  const base = { kind, dataDir, mounts: userMounts(env), token: bridgeToken(dataDir) };
  if (kind === "stack") return base;
  const [account = "default", port, knowledgeDir] = rest;
  return { ...base, account, port: Number(port) || 9555, ...(knowledgeDir ? { knowledgeDir } : {}) };
}

async function serve(kind, rest) {
  const name = ensureUp(specFrom(kind, rest));
  console.log(`[app-docker] ${name} is up`);
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    if (!running(name)) {
      console.error(`[app-docker] ${name} is not running any more`);
      process.exit(1);
    }
  }
}

function down(what) {
  const list = docker(["ps", "-a", "--filter", "label=zeff.service", "--format", "{{.Names}}"]).stdout?.split(/\r?\n/).filter(Boolean) ?? [];
  const names = what === "all" ? list : list.filter((n) => (what === "stack" ? n === "zeff-stack" : n.startsWith("zeff-knowledge") && (!what.includes(":") || n === containerName("knowledge", what.split(":")[1]))));
  for (const n of names) docker(["rm", "-f", n]);
  return names;
}

function status() {
  const out = docker(["ps", "-a", "--filter", "label=zeff.service", "--format", "{{json .}}"]).stdout ?? "";
  const containers = out.split(/\r?\n/).filter(Boolean).flatMap((l) => {
    try {
      const j = JSON.parse(l);
      return [{ name: j.Names, image: j.Image, status: j.Status, state: j.State, ports: j.Ports }];
    } catch {
      return [];
    }
  });
  return { image: imageExists(), containers };
}

async function main() {
  const [cmd, kind, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "--build":
      return process.exit(build());
    case "--serve":
      if (kind !== "stack" && kind !== "knowledge") throw new Error("--serve stack | knowledge <account> <port> [dataDir]");
      return serve(kind, rest);
    case "--down":
      console.log(JSON.stringify(down(kind ?? "all")));
      return;
    case "--status":
      console.log(JSON.stringify(status()));
      return;
    default:
      console.error("usage: app-docker.mjs --build | --serve stack | --serve knowledge <account> <port> [dataDir] | --down [stack|knowledge|all] | --status");
      process.exit(2);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`[app-docker] ${e?.message ?? e}`);
    process.exit(1);
  });
}

