#!/usr/bin/env node
/**
 * A live worker session's own host: node scripts/work-session-host.mjs <config.json>
 *
 * For a session run as administrator — and where there's no launcher with its work host
 * (scripts/work-host.mjs; `npm run dev`). It owns one Claude CLI process (stream-json in and out)
 * so the session outlives Zeff's server — a restart, a deploy. What the CLI prints goes line by
 * line into the run's log; what Zeff sends (your messages, your answers to its permission
 * requests, mode switches) comes in over a local TCP socket (127.0.0.1, first line: the token
 * from the config) and goes to the CLI. (Zeff keeps what it sends beside the log itself.)
 *
 * Zeff finds the host through the info file (port, pids) the host writes once it listens and
 * removes when it ends. It ends when the CLI does. Started elevated (as administrator), it runs
 * the CLI elevated — Zeff still reaches it over TCP (a pipe wouldn't cross the integrity levels).
 *
 * Config: { command, args, cwd, log, err, info, token, elevated? }
 */
import { spawn, execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";

// Started with --detach (by Zeff's server): start the real host on its own and go — so it isn't
// in the server's process tree, and a restart (taskkill /T on the server, as deploy does) leaves
// it, its CLI and what that runs (a deploy of Zeff itself) alone.
if (process.argv.includes("--detach")) {
  spawn(process.execPath, [process.argv[1], process.argv[2]], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  process.exit(0);
}

const cfg = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const logFd = fs.openSync(cfg.log, "a");
const errFd = fs.openSync(cfg.err, "a");
const now = () => new Date().toISOString();
/** One whole line into the log (the only writer while the host lives: lines never interleave). */
const record = (o) => fs.writeSync(logFd, `${JSON.stringify(o)}\n`);

// The environment: this process' own, without what marks a nested session (Zeff strips the rest
// before it starts the host; an elevated host has the user's environment from Windows).
const env = { ...process.env };
for (const k of ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "NODE_OPTIONS"]) delete env[k];

const child = spawn(cfg.command, cfg.args, { cwd: cfg.cwd, env, stdio: ["pipe", "pipe", errFd], windowsHide: true });
record({ type: "zeff_host", event: "start", at: now(), pid: process.pid, childPid: child.pid ?? null, elevated: !!cfg.elevated });

let out = "";
child.stdout.on("data", (d) => {
  out += d;
  let n;
  while ((n = out.indexOf("\n")) >= 0) {
    const line = out.slice(0, n).trim();
    out = out.slice(n + 1);
    if (line) fs.writeSync(logFd, `${line}\n`);
  }
});
child.stdin.on("error", () => {}); // a CLI that quit: its exit says why

/** The CLI and everything it started (tests, servers) — gone. */
function killTree() {
  if (!child.pid) return;
  if (process.platform === "win32") execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
  else child.kill("SIGTERM");
}

const token = Buffer.from(String(cfg.token));
const server = net.createServer((sock) => {
  let buf = "";
  let authed = false;
  sock.setEncoding("utf8");
  sock.on("error", () => {});
  sock.on("data", (d) => {
    buf += d;
    if (buf.length > 64 * 1024 * 1024) return sock.destroy(); // nothing Zeff sends is that big
    let n;
    while ((n = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, n).trim();
      buf = buf.slice(n + 1);
      if (!authed) {
        const got = Buffer.from(line);
        authed = got.length === token.length && crypto.timingSafeEqual(got, token);
        if (!authed) return sock.destroy();
        sock.write("ok\n");
        continue;
      }
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.zeffHost === "stop") child.stdin.end();
      else if (msg.zeffHost === "kill") killTree();
      else child.stdin.write(`${JSON.stringify(msg)}\n`);
    }
  });
});

server.listen(0, "127.0.0.1", () => {
  const info = { pid: process.pid, childPid: child.pid ?? null, port: server.address().port, startedAt: now(), elevated: !!cfg.elevated };
  fs.writeFileSync(`${cfg.info}.tmp`, JSON.stringify(info));
  fs.renameSync(`${cfg.info}.tmp`, cfg.info);
});

function end(code, signal) {
  if (out.trim()) fs.writeSync(logFd, `${out.trim()}\n`);
  record({ type: "zeff_host", event: "exit", at: now(), code, signal });
  try {
    fs.rmSync(cfg.info, { force: true });
  } catch {
    // gone already
  }
  server.close();
  process.exit(0);
}
child.on("exit", (code, signal) => end(code, signal));
child.on("error", (e) => {
  fs.writeSync(errFd, `${e.message}\n`);
  end(null, "spawn-error");
});
// The host told to go (taskkill on it, Ctrl+C): the CLI goes with it.
for (const s of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(s, () => killTree());
