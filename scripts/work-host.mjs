#!/usr/bin/env node
/**
 * Zeff's work host — the launcher runs it next to Zeff's server (ZEFF_WORK_PORT, default 9334).
 * Zeff's workers (Claude / Copilot CLI runs) are started here, not by Zeff's Next server: their
 * process trees are the host's, so a restart of the server — `npm run deploy`, a crash — doesn't
 * cut them off, and a session can deploy Zeff without taking itself down.
 *
 * The host knows nothing about runs but their pid: it starts a process (stdin, output files,
 * working folder and environment given by Zeff), and when it ends tells Zeff — POST
 * <ZEFF_URL>/api/work/exit — retrying until Zeff is up (it is restarting during a deploy).
 * Plain Node, no dependencies. Loopback only; every request carries ZEFF_WORK_TOKEN.
 *
 *   GET  /health            → { ok, children }
 *   POST /spawn { runId, account, command, args, cwd, env, stdin, outFile, errFile } → { pid }
 *
 * What it has started is in <ZEFF_WORK_STATE>: after the host itself restarts it watches those
 * processes again and reports their end all the same.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const PORT = Number(process.env.ZEFF_WORK_PORT) || 9334;
const ZEFF_URL = (process.env.ZEFF_URL || "http://127.0.0.1:9333").replace(/\/$/, "");
const TOKEN = process.env.ZEFF_WORK_TOKEN || "";
const STATE = process.env.ZEFF_WORK_STATE || path.join(process.cwd(), "data", "launcher", "work-host.json");
const log = (...a) => console.log(new Date().toISOString(), "[work-host]", ...a);

/** runId → { runId, account, pid, ended } — started here and not reported to Zeff yet. */
const children = new Map();

function save() {
  try {
    fs.mkdirSync(path.dirname(STATE), { recursive: true });
    fs.writeFileSync(STATE, JSON.stringify([...children.values()].map(({ runId, account, pid, ended }) => ({ runId, account, pid, ended }))));
  } catch (e) {
    log(`state not saved: ${e.message}`);
  }
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

/** Tell Zeff the process is over — until it answers. */
async function report(c) {
  c.ended = true;
  save();
  for (let delay = 1000; ; delay = Math.min(delay * 2, 15000)) {
    try {
      const r = await fetch(`${ZEFF_URL}/api/work/exit`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-zeff-work-token": TOKEN },
        body: JSON.stringify({ runId: c.runId, account: c.account }),
        signal: AbortSignal.timeout(30000),
      });
      // 200: taken in; 4xx: Zeff doesn't know the run (any more) — nothing to wait for.
      if (r.ok || (r.status >= 400 && r.status < 500)) break;
    } catch {
      // Zeff is down (restarting): again in a moment
    }
    await new Promise((r) => setTimeout(r, delay));
  }
  children.delete(c.runId);
  save();
}

/** A process started before this host's restart: watched by its pid. */
function adopt(c) {
  if (c.ended || !alive(c.pid)) return void report(c);
  const t = setInterval(() => {
    if (alive(c.pid)) return;
    clearInterval(t);
    void report(c);
  }, 2000);
}

function start(spec) {
  const { runId, account, command, args, cwd, env, stdin, outFile, errFile } = spec;
  if (!Number.isInteger(runId) || typeof command !== "string" || !Array.isArray(args)) throw new Error("bad spawn request");
  if (children.has(runId)) throw new Error(`run ${runId} is started already`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const out = fs.openSync(outFile, "a");
  const err = fs.openSync(errFile, "a");
  let child;
  try {
    child = spawn(command, args, { cwd, env, stdio: ["pipe", out, err], windowsHide: true, detached: true });
  } finally {
    fs.closeSync(out);
    fs.closeSync(err);
  }
  const c = { runId, account, pid: child.pid ?? 0, ended: false };
  children.set(runId, c);
  child.on("error", (e) => {
    fs.appendFileSync(errFile, `${e.message}\n`);
    void report(c);
  });
  child.on("exit", () => void report(c));
  child.stdin.on("error", () => {}); // a CLI that quits early: its exit says why
  child.stdin.end(stdin ?? "", "utf8");
  child.unref();
  save();
  log(`run ${runId}: ${path.basename(command)} pid ${c.pid}`);
  return c.pid;
}

const server = http.createServer((req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  // Another website's request (a browser sends Origin) or without the token: refused.
  if (req.headers.origin || (TOKEN && req.headers["x-zeff-work-token"] !== TOKEN)) return send(403, { error: "forbidden" });
  if (req.method === "GET" && req.url === "/health") return send(200, { ok: true, children: children.size });
  if (req.method === "POST" && req.url === "/spawn") {
    let body = "";
    req.on("data", (d) => {
      body += d;
      if (body.length > 20 * 1024 * 1024) req.destroy();
    });
    req.on("end", () => {
      try {
        send(200, { pid: start(JSON.parse(body)) });
      } catch (e) {
        send(400, { error: e instanceof Error ? e.message : String(e) });
      }
    });
    return;
  }
  send(404, { error: "not found" });
});

try {
  for (const c of JSON.parse(fs.readFileSync(STATE, "utf8"))) {
    children.set(c.runId, c);
    adopt(c);
  }
} catch {
  // no state yet
}
server.listen(PORT, "127.0.0.1", () => log(`listening on 127.0.0.1:${PORT}, reporting to ${ZEFF_URL}`));
