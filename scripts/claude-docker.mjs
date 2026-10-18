#!/usr/bin/env node
/**
 * Claude Code in a Docker container, for a host that cannot have the CLI: a service container ("zeff-claude", started by the
 * launcher or by `npm run claude:up`) that has Claude Code, git and your repos mounted — and THIS script, which Zeff runs in place of
 * the CLI (CLAUDE_CLI=<this file>; Zeff runs a .mjs CLAUDE_CLI with node, everywhere it starts Claude: workers, live sessions,
 * the mail review, the document reader). It forwards the call into the container with `docker exec -i`: arguments, the working
 * folder and the stream-json on stdin/stdout as they are — only paths and the address of Zeff's MCP server are put right:
 *
 *   C:\Users\you\Documents\PROJ\repo   →  /host/documents/PROJ/repo     (the mounts: ZEFF_CLAUDE_MOUNTS)
 *   http://127.0.0.1:9333/api/mcp/…   →  http://host.docker.internal:9333/api/mcp/…
 *
 *   claude-docker.mjs <claude arguments>     the shim (what Zeff runs)
 *   claude-docker.mjs --serve                the container up and watched (the launcher's "Claude" service)
 *   claude-docker.mjs --up | --down          the container in the background / gone
 *   claude-docker.mjs --build                the image (docker/claude/Dockerfile)
 *   claude-docker.mjs --kill <runId>         a run's claude (and what it started) inside the container
 *   claude-docker.mjs --status               is it up
 *
 * ZEFF_CLAUDE_MOUNTS  "C:\Users\you\Documents=/host/documents;D:\Work=/host/work"  (default: your Documents folder)
 * ZEFF_CLAUDE_IMAGE   zeff-claude:local        ZEFF_CLAUDE_CONTAINER   zeff-claude        ZEFF_CLAUDE_HOME   zeff-claude-home (the volume with its sign-in)
 */
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
export const HEALTH_PORT = 9335;

// ---------------------------------------------------------------------------------------------------------------------
// Mounts and paths
// ---------------------------------------------------------------------------------------------------------------------

/** @typedef {{ host: string, local: string, readOnly?: boolean }} Mount */

/**
 * The mounts as the setting writes them: "host=container;host=container". A host side is a Windows path (C:\…, \\server\share) or
 * a posix one; the container side an absolute path. A trailing ":ro" on the container side mounts it read-only.
 * @param {string | undefined} text
 * @returns {Mount[]}
 */
export function parseMounts(text) {
  return String(text ?? "")
    .split(";")
    .map((entry) => {
      const i = entry.indexOf("=");
      let local = entry.slice(i + 1).trim();
      const readOnly = /:ro$/i.test(local);
      if (readOnly) local = local.slice(0, -3);
      return { host: entry.slice(0, i).trim().replace(/[\\/]+$/, ""), local: local.replace(/\/+$/, ""), ...(readOnly ? { readOnly } : {}) };
    })
    .filter((m) => m.host && m.local.startsWith("/"));
}

/**
 * What Zeff itself hands to Claude from its data folder (the pictures sent with a prompt, the documents Claude reads) is mounted
 * read-only — and only those folders: Zeff's databases and tokens stay out of reach.
 * @param {string} dataDir
 * @returns {Mount[]}
 */
export function dataMounts(dataDir) {
  return [
    { host: path.join(dataDir, "work", "attachments"), local: "/host/zeff/attachments", readOnly: true },
    { host: path.join(dataDir, "documents"), local: "/host/zeff/documents", readOnly: true },
  ];
}

export function defaultMounts(env = process.env, home = os.homedir()) {
  const own = parseMounts(env.ZEFF_CLAUDE_MOUNTS);
  return [...(own.length ? own : [{ host: path.join(home, "Documents"), local: "/host/documents" }]), ...dataMounts(env.ZEFF_DATA_DIR || path.join(ROOT, "data"))];
}

const slash = (p) => String(p).replace(/\\/g, "/").replace(/\/+$/, "");

/** A host path as the container has it (on the boundary of a mounted folder, any slash, any case); null when it is not mounted. */
export function toContainerPath(p, mounts) {
  const n = slash(p);
  for (const m of mounts) {
    const h = slash(m.host);
    if (n.toLowerCase() === h.toLowerCase()) return m.local;
    if (n.toLowerCase().startsWith(`${h.toLowerCase()}/`)) return `${m.local}${n.slice(h.length)}`;
  }
  return null;
}

/** The container's side of an argument: a mounted path, or "--flag=<mounted path>"; anything else is left alone. */
export function mapArg(arg, mounts) {
  const direct = toContainerPath(arg, mounts);
  if (direct) return direct;
  const eq = /^(--[\w-]+=)(.+)$/.exec(arg);
  if (eq) {
    const inner = toContainerPath(eq[2], mounts);
    if (inner) return `${eq[1]}${inner}`;
  }
  return arg;
}

// ---------------------------------------------------------------------------------------------------------------------
// MCP servers: Zeff's is on the host
// ---------------------------------------------------------------------------------------------------------------------

/** Loopback → the host, as the container reaches it. */
export const hostAddress = (text) => String(text).replace(/(https?:\/\/)(127\.0\.0\.1|localhost|\[::1\])(?=[:/])/gi, "$1host.docker.internal");

/**
 * `--mcp-config <file or json>` as an inline JSON the container can use: the file is read here (it is a host path), the servers'
 * addresses point at the host. A server that is a program to start (stdio) cannot run in the container — it is dropped, with a
 * note on stderr. Returns null when the text is neither a readable file nor JSON.
 * @param {string} value
 * @param {{ read?: (p: string) => string, warn?: (s: string) => void }} [io]
 */
export function containerMcpConfig(value, { read = (p) => fs.readFileSync(p, "utf8"), warn = (s) => process.stderr.write(`${s}\n`) } = {}) {
  let text = value.trim();
  if (!text.startsWith("{")) {
    try {
      text = read(value);
    } catch {
      return null;
    }
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const servers = {};
  for (const [name, s] of Object.entries(json.mcpServers ?? {})) {
    if (s && typeof s === "object" && "url" in s) servers[name] = { ...s, url: hostAddress(s.url) };
    else warn(`[claude-docker] the MCP server "${name}" is a program on this computer — it cannot run in the container and is left out.`);
  }
  return JSON.stringify({ ...json, mcpServers: servers });
}

// ---------------------------------------------------------------------------------------------------------------------
// The call: arguments, folder, environment
// ---------------------------------------------------------------------------------------------------------------------

/** What of the environment goes into the container: Claude's own settings and the run's identity — nothing else of the host's. */
const ENV_ALLOW = /^(CLAUDE_|ANTHROPIC_|MAX_THINKING_TOKENS$|DISABLE_|ZEFF_WORK_(RUN|ACCOUNT|VIA_HOST)$|ZEFF_MCP_TOKEN$|TERM$|LANG$|LC_)/;
const ENV_BLOCK = /^(CLAUDECODE|CLAUDE_CODE_ENTRYPOINT|CLAUDE_CLI)$/;

/**
 * The `docker exec` for one call of the CLI: the argument list after `docker`. Pure — the tests give it everything it needs.
 * @param {{ argv: string[], cwd: string, env: Record<string, string | undefined>, mounts: Mount[], container?: string, read?: (p: string) => string, warn?: (s: string) => void }} o
 */
export function execArgs({ argv, cwd, env, mounts, container = "zeff-claude", read, warn }) {
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mcp-config" && i + 1 < argv.length) {
      const inline = containerMcpConfig(argv[i + 1], { read, warn });
      args.push(a, inline ?? mapArg(argv[i + 1], mounts));
      i++;
    } else if (a.startsWith("--mcp-config=")) {
      const inline = containerMcpConfig(a.slice(13), { read, warn });
      args.push(inline ? `--mcp-config=${inline}` : mapArg(a, mounts));
    } else args.push(mapArg(a, mounts));
  }
  const workdir = toContainerPath(cwd, mounts) ?? "/tmp";
  const run = env.ZEFF_WORK_RUN && /^\d+$/.test(env.ZEFF_WORK_RUN) ? env.ZEFF_WORK_RUN : null;
  const passEnv = Object.entries(env)
    .filter(([k, v]) => v !== undefined && ENV_ALLOW.test(k) && !ENV_BLOCK.test(k))
    .flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  // setsid -w: the CLI leads a session and process group of its own — what it starts can be ended with it (--kill) — and the exec waits for it
  // (without -w setsid forks and the exec ends at once, "without a result"). The inner shell writes its pid — the group's — and becomes the CLI.
  const script = run ? `mkdir -p /tmp/zeff-run; exec setsid -w sh -c 'echo $$ > /tmp/zeff-run/${run}.pid; exec "$@"' sh "$@"` : 'exec setsid -w "$@"';
  return ["exec", "-i", "-w", workdir, ...passEnv, container, "sh", "-c", script, "sh", "claude", ...args];
}

/**
 * The docker arguments that start the service container (detached, or in the foreground with `foreground`).
 * @param {{ mounts: Mount[], image?: string, container?: string, home?: string, foreground?: boolean, healthPort?: number, memory?: string, cpus?: string }} o
 * @returns {string[]}
 */
export function runArgs({ mounts, image = "zeff-claude:local", container = "zeff-claude", home = "zeff-claude-home", foreground = false, healthPort = HEALTH_PORT, memory, cpus }) {
  const label = crypto.createHash("sha1").update(JSON.stringify({ mounts, image, home })).digest("hex").slice(0, 16);
  return [
    "run",
    ...(foreground ? ["--rm"] : ["-d", "--restart", "unless-stopped"]),
    "--init",
    "--name",
    container,
    "--label",
    `zeff.config=${label}`,
    "--add-host",
    "host.docker.internal:host-gateway",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "2048",
    ...(memory ? ["--memory", memory] : []),
    ...(cpus ? ["--cpus", cpus] : []),
    "-p",
    `127.0.0.1:${healthPort}:${healthPort}`,
    "-v",
    `${home}:/home/node`,
    ...mounts.flatMap((m) => ["-v", `${m.host}:${m.local}${m.readOnly ? ":ro" : ""}`]),
    image,
  ];
}

// ---------------------------------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------------------------------

const names = (env = process.env) => ({
  image: env.ZEFF_CLAUDE_IMAGE || "zeff-claude:local",
  container: env.ZEFF_CLAUDE_CONTAINER || "zeff-claude",
  home: env.ZEFF_CLAUDE_HOME || "zeff-claude-home",
});

const docker = (args, opts = {}) => spawnSync("docker", args, { encoding: "utf8", windowsHide: true, ...opts });

const imageExists = (image) => docker(["image", "inspect", image]).status === 0;
const running = (container) => docker(["inspect", "-f", "{{.State.Running}}", container]).stdout?.trim() === "true";

function build() {
  const { image } = names();
  const r = spawnSync("docker", ["build", "-t", image, "-f", path.join(ROOT, "docker", "claude", "Dockerfile"), path.join(ROOT, "docker", "claude")], { stdio: "inherit", windowsHide: true });
  return r.status ?? 1;
}

/** The container running with the current settings (a changed setting recreates it). */
function ensureUp() {
  const { image, container, home } = names();
  const mounts = defaultMounts();
  if (!imageExists(image)) {
    process.stderr.write(`[claude-docker] the image ${image} is missing — building it (docker/claude/Dockerfile) …\n`);
    if (build() !== 0) throw new Error("the image could not be built");
  }
  const want = runArgs({ mounts, image, container, home }).find((a) => a.startsWith("zeff.config="));
  const have = docker(["inspect", "-f", '{{index .Config.Labels "zeff.config"}}', container]).stdout?.trim();
  if (running(container) && have === want?.slice(12)) return;
  docker(["rm", "-f", container]);
  const r = docker(runArgs({ mounts, image, container, home }));
  if (r.status !== 0) throw new Error(`docker run failed: ${String(r.stderr).trim()}`);
}

/**
 * The launcher's "Claude" service: the container up (made when it is missing or its settings changed), then watched — when it stops,
 * this ends and the launcher starts it again. The container outlives this process and the launcher (restart: unless-stopped);
 * `--down` ends it.
 */
async function serve() {
  ensureUp();
  console.log(`[claude-docker] ${names().container} is up (health port ${HEALTH_PORT})`);
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    if (!running(names().container)) {
      console.error("[claude-docker] the container is not running any more");
      process.exit(1);
    }
  }
}

function kill(runId) {
  const { container } = names();
  if (!/^\d+$/.test(String(runId))) return 2;
  const f = `/tmp/zeff-run/${runId}.pid`;
  const r = docker(["exec", container, "sh", "-c", `[ -f ${f} ] && { kill -TERM -$(cat ${f}) 2>/dev/null; sleep 2; kill -KILL -$(cat ${f}) 2>/dev/null; rm -f ${f}; }; true`]);
  return r.status ?? 1;
}

function shim() {
  const { container } = names();
  if (!running(container)) {
    try {
      ensureUp();
    } catch (e) {
      process.stderr.write(`[claude-docker] ${e.message}\n`);
      process.exit(127);
    }
  }
  const call = execArgs({ argv: process.argv.slice(2), cwd: process.cwd(), env: process.env, mounts: defaultMounts(), container });
  const child = spawn("docker", call, { stdio: "inherit", windowsHide: true });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 143 : 1)));
  child.on("error", (e) => {
    process.stderr.write(`[claude-docker] docker could not be started: ${e.message}\n`);
    process.exit(127);
  });
}

const listening = (port) =>
  new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
  });

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "--serve":
      return serve();
    case "--up":
      return ensureUp();
    case "--down":
      return void docker(["rm", "-f", names().container]);
    case "--build":
      return process.exit(build());
    case "--kill":
      return process.exit(kill(rest[0]));
    case "--status": {
      const up = running(names().container);
      console.log(JSON.stringify({ image: imageExists(names().image), running: up, health: up ? await listening(HEALTH_PORT) : false }));
      return;
    }
    default:
      return shim();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve(main()).catch((e) => {
    process.stderr.write(`[claude-docker] ${e?.message ?? e}\n`);
    process.exit(1);
  });
}
