// Keeps one Next server (`node next start [dir] -H 127.0.0.1 -p <port>`) running: start, stop,
// restart on command, and restart after a crash with a growing pause (2 s … 60 s). A server that
// already holds the port (e.g. the old "Zeff Server" scheduled task) is left alone and shown as
// external — the proxy serves it all the same.
const { spawn, execFile } = require("node:child_process");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const net = require("node:net");
const { log, rotate } = require("./log");

const LABELS = {
  stopped: "stopped",
  starting: "starting…",
  running: "running",
  crashed: "crashed, restarting…",
  external: "running (not started by the launcher)",
  notBuilt: "not built",
};

const portOpen = (port) =>
  new Promise((resolve) => {
    const s = net.connect({ port, host: "127.0.0.1" });
    const done = (ok) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(400, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });

class Service extends EventEmitter {
  /** spec: { name, port, node, args, cwd, env, logFile, buildMarker } */
  constructor(spec) {
    super();
    Object.assign(this, { spec, name: spec.name, port: spec.port, logFile: spec.logFile });
    this.status = "stopped";
    this.pid = null;
    this.restarts = 0;
    this.desired = false;
    this.child = null;
    this.backoff = 0;
    this.notBefore = 0;
    this.busy = false;
    this.timer = setInterval(() => this.tick(), 1000);
  }

  get label() {
    return LABELS[this.status];
  }

  snapshot() {
    return { name: this.name, port: this.port, status: this.status, label: this.label, pid: this.pid, restarts: this.restarts };
  }

  set(status, pid = this.pid) {
    const changed = status !== this.status || pid !== this.pid;
    if (status !== this.status) log(`[${this.name}] ${LABELS[status]}`);
    this.status = status;
    this.pid = pid;
    if (changed) this.emit("change");
  }

  start() {
    this.desired = true;
    this.notBefore = 0;
    this.tick();
  }

  async stop() {
    this.desired = false;
    await this.kill();
    this.set("stopped", null);
  }

  async restart() {
    this.desired = true;
    await this.kill();
    this.backoff = 0;
    this.notBefore = 0;
    this.tick();
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      if (!this.child) {
        if (!this.desired) {
          if (this.status !== "external") this.set("stopped", null);
        } else if (Date.now() >= this.notBefore) {
          if (!fs.existsSync(this.spec.buildMarker)) this.set("notBuilt", null);
          else if (await portOpen(this.port)) this.set("external", null);
          else this.launch();
        }
      } else if (this.status === "starting" && (await portOpen(this.port))) {
        log(`[${this.name}] listening on 127.0.0.1:${this.port} after ${((Date.now() - this.startedAt) / 1000).toFixed(1)}s`);
        this.backoff = 0;
        this.set("running");
      }
    } finally {
      this.busy = false;
    }
  }

  launch() {
    const { node, args, cwd, logFile } = this.spec;
    // (A function: asked at each start — what the server is told can change between two starts.)
    const env = typeof this.spec.env === "function" ? this.spec.env() : this.spec.env;
    rotate(logFile, 10 * 1024 * 1024);
    const fd = fs.openSync(logFile, "a");
    let child;
    try {
      child = spawn(node, args, { cwd, env, stdio: ["ignore", fd, fd], windowsHide: true });
    } finally {
      fs.closeSync(fd);
    }
    this.child = child;
    this.startedAt = Date.now();
    child.once("error", (e) => log(`[${this.name}] couldn't start: ${e.message}`));
    child.once("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      log(`[${this.name}] exited (${signal ?? `code ${code}`})`);
      if (this.desired) {
        this.restarts++;
        this.backoff = Math.min(Math.max(this.backoff * 2, 2000), 60000);
        this.notBefore = Date.now() + this.backoff;
        this.set("crashed", null);
      }
      this.emit("exit");
    });
    log(`[${this.name}] started pid ${child.pid}`);
    this.set("starting", child.pid ?? null);
  }

  kill() {
    const child = this.child;
    if (!child) return Promise.resolve();
    this.child = null;
    return new Promise((resolve) => {
      const t = setTimeout(resolve, 10000);
      child.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
      child.kill();
    });
  }

  dispose() {
    clearInterval(this.timer);
  }
}

/**
 * Servers a previous launcher left behind (it was killed, not quit): their pids are in
 * pids.json. Only a node[.exe] running `next … start … -p <its port>` is killed.
 */
function killLeftovers(pidsFile) {
  let pids = {};
  try {
    pids = JSON.parse(fs.readFileSync(pidsFile, "utf8"));
  } catch {
    return Promise.resolve();
  }
  const entries = Object.values(pids).filter((p) => Number.isInteger(p?.pid) && Number.isInteger(p?.port));
  if (!entries.length) return Promise.resolve();
  // pid, name, command line — tab-separated (Windows), or as ps prints them (macOS, Linux).
  const [file, args, parse] =
    process.platform === "win32"
      ? [
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `Get-CimInstance Win32_Process -Filter "${entries.map((p) => `ProcessId=${p.pid}`).join(" or ")}" | ForEach-Object { "$($_.ProcessId)\`t$($_.Name)\`t$($_.CommandLine)" }`,
          ],
          (line) => line.split("\t"),
        ]
      : [
          "ps",
          ["-o", "pid=,comm=,args=", "-p", entries.map((p) => p.pid).join(",")],
          (line) => {
            const m = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line);
            return m ? [m[1], m[2].split("/").pop(), m[3]] : [];
          },
        ];
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true }, (_e, stdout) => {
      for (const line of String(stdout ?? "").split(/\r?\n/)) {
        const [pid, name = "", cmd = ""] = parse(line);
        const entry = entries.find((p) => String(p.pid) === pid);
        if (entry && /^node(\.exe)?$/i.test(name) && /next/.test(cmd) && cmd.includes(` -p ${entry.port}`)) {
          log(`killing a server left behind: pid ${pid} (port ${entry.port})`);
          try {
            process.kill(Number(pid));
          } catch {}
        }
      }
      resolve();
    });
  });
}

module.exports = { Service, portOpen, killLeftovers };
