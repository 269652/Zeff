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
 *   GET  /health            → { ok, children, features } — `features`: what this host's code can do
 *        (Zeff asks before it relies on it: an older host still running is used for what it knows)
 *   POST /spawn { runId, account, command, args, cwd, env, stdin, outFile, errFile, live? } → { pid }
 *   POST /message { runId, text } → { ok } — into a live run, or 409 when it is closing / not live
 *   POST /write { runId, line } → { ok } — one stream-json line as it is (a live Claude session's
 *        answers to its permission requests, interrupt, mode or model switches)
 *   POST /close { runId } → { ok } — ends a live run's stdin (the CLI finishes and quits)
 *   POST /kill { runId } → { ok } — the run's process and everything it started, gone
 *
 * A live session (`keep`) stays open until Zeff closes it — a conversation waits for you between
 * turns; its first lines (`stdinLines`) go in as they are.
 *
 * A live run (Claude with --input-format stream-json): its stdin stays open, the first message is
 * `stdin`, more come through /message — the CLI takes them in when it is idle (or at its next
 * step). When the CLI has answered ("result") and nothing else happens for IDLE_MS, the host ends
 * its stdin, the CLI quits, and the run is reported over as always.
 *
 * What it has started is in <ZEFF_WORK_STATE>: after the host itself restarts it watches those
 * processes again and reports their end all the same.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const PORT = Number(process.env.ZEFF_WORK_PORT) || 9334;
/** What this host can do — Zeff checks it (a host started before an update keeps its old code till it restarts). */
const FEATURES = ["spawn", "message", "write", "keep", "close", "kill"];
const ZEFF_URL = (process.env.ZEFF_URL || "http://127.0.0.1:9333").replace(/\/$/, "");
const TOKEN = process.env.ZEFF_WORK_TOKEN || "";
const STATE = process.env.ZEFF_WORK_STATE || path.join(process.cwd(), "data", "launcher", "work-host.json");
const IDLE_MS = Number(process.env.ZEFF_WORK_IDLE_MS) || 2500;
const NL = String.fromCharCode(10);
const userLine = (text) => JSON.stringify({ type: "user", message: { role: "user", content: text } }) + NL;
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
    // Not detached on Windows: a detached process has no console, and every console program it starts (git, a shell, tests) would open a window of its own.
    // The host's console is hidden (the launcher starts it windowsHide), and the workers share it. Elsewhere detached gives the run its own process group (killed as one).
    child = spawn(command, args, { cwd, env, stdio: ["pipe", out, err], windowsHide: true, detached: process.platform !== "win32" });
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
  if (spec.live) {
    c.live = { stdin: child.stdin, closed: false, timer: null, keep: !!spec.keep };
    if (Array.isArray(spec.stdinLines)) for (const line of spec.stdinLines) child.stdin.write(`${line}${NL}`, "utf8");
    else child.stdin.write(userLine(stdin ?? ""), "utf8");
    watchOutput(c, outFile);
    child.on("exit", () => {
      c.live.closed = true;
      clearTimeout(c.live.timer);
      fs.unwatchFile(outFile);
    });
  } else child.stdin.end(stdin ?? "", "utf8");
  child.unref();
  save();
  log(`run ${runId}: ${path.basename(command)} pid ${c.pid}`);
  return c.pid;
}

/**
 * A CLI in the container (CLAUDE_CLI / COPILOT_CLI / CODEX_CLI = scripts/<tool>-docker.mjs): the process here is only the shim of
 * `docker exec` — ending it does not end the CLI in the container (nor what it started). That is asked for there, by the run's number.
 */
function killInContainer(runId) {
  if (!Number.isInteger(runId)) return;
  const shim = ["CLAUDE_CLI", "COPILOT_CLI", "CODEX_CLI"].map((k) => process.env[k] ?? "").find((v) => /-docker\.mjs$/i.test(v));
  if (shim) spawn(process.execPath, [shim, "--kill", String(runId)], { stdio: "ignore", windowsHide: true, detached: true }).unref();
}

/** A run's process and everything it started (tests, servers) — gone. */
function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  else
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // gone already
      }
    }
}

/** Closes a live run's stdin once the CLI has answered and nothing follows. */
function closeLive(c) {
  if (c.live.closed) return;
  c.live.closed = true;
  c.live.stdin.end();
  log(`run ${c.runId}: idle - stdin closed`);
}

/** Reads what the CLI appends to its output file: a "result" means idle; any other step, busy again. */
function watchOutput(c, file) {
  let offset = 0;
  let rest = "";
  const read = () => {
    let size;
    try {
      size = fs.statSync(file).size;
    } catch {
      return;
    }
    if (size <= offset) return;
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);
    offset = size;
    const lines = (rest + buf.toString("utf8")).split(NL);
    rest = lines.pop() ?? "";
    for (const line of lines) {
      let type;
      try {
        type = JSON.parse(line).type;
      } catch {
        continue;
      }
      if (type === "result") {
        clearTimeout(c.live.timer);
        if (c.live.keep) continue; // a session: open till Zeff closes it
        c.live.timer = setTimeout(() => closeLive(c), IDLE_MS);
      } else if (type === "assistant" || type === "stream_event") clearTimeout(c.live.timer);
    }
  };
  fs.watchFile(file, { interval: 400 }, read);
}

const server = http.createServer((req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  // Another website's request (a browser sends Origin) or without the token: refused.
  if (req.headers.origin || (TOKEN && req.headers["x-zeff-work-token"] !== TOKEN)) return send(403, { error: "forbidden" });
  if (req.method === "GET" && req.url === "/health") return send(200, { ok: true, children: children.size, features: FEATURES });
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
  if (req.method === "POST" && (req.url === "/write" || req.url === "/close" || req.url === "/kill")) {
    let body = "";
    req.on("data", (d) => {
      body += d;
      if (body.length > 64 * 1024 * 1024) req.destroy(); // images go along: big, not that big
    });
    req.on("end", () => {
      try {
        const { runId, line } = JSON.parse(body);
        const c = children.get(runId);
        if (!c) return send(404, { error: "unknown run" });
        if (req.url === "/kill") {
          killInContainer(runId);
          killTree(c.pid);
          return send(200, { ok: true });
        }
        if (!c.live || c.live.closed) return send(409, { error: "closed" });
        if (req.url === "/close") {
          closeLive(c);
          return send(200, { ok: true });
        }
        if (typeof line !== "string") return send(400, { error: "no line" });
        JSON.parse(line); // one JSON line, nothing else
        clearTimeout(c.live.timer);
        c.live.stdin.write(`${line.replace(/[\r\n]+/g, " ")}${NL}`, "utf8");
        send(200, { ok: true });
      } catch (e) {
        send(400, { error: e instanceof Error ? e.message : String(e) });
      }
    });
    return;
  }
  if (req.method === "POST" && req.url === "/message") {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      try {
        const { runId, text } = JSON.parse(body);
        const c = children.get(runId);
        if (!c?.live || c.live.closed || typeof text !== "string" || !text.trim()) return send(409, { error: "closed" });
        clearTimeout(c.live.timer);
        c.live.stdin.write(userLine(text), "utf8");
        send(200, { ok: true });
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

// Its own code updated (a deploy, a pull): once nothing runs on it any more, it ends — the launcher
// starts it again (with the new code). Workers running meanwhile keep it until they're done.
const SELF = process.argv[1];
let stale = false;
const selfAt = (() => {
  try {
    return fs.statSync(SELF).mtimeMs;
  } catch {
    return 0;
  }
})();
const checkSelf = () => {
  try {
    if (!stale && fs.statSync(SELF).mtimeMs !== selfAt) {
      stale = true;
      log("its code changed - restarting once no worker runs on it");
    }
  } catch {
    // moved: leave it
  }
  if (stale && ![...children.values()].some((c) => !c.ended)) {
    log("restarting for the new code");
    process.exit(0);
  }
};
setInterval(checkSelf, 5000).unref();
