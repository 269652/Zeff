#!/usr/bin/env node
/**
 * The host side of Zeff in a container: lets the container reach and start the automation browser (Chrome, Edge …) that
 * runs on THIS computer, and tells Zeff whether your security key is plugged in.
 *
 *   node scripts/chrome-bridge.mjs            (npm run docker:bridge)
 *
 *  - CDP proxies. Chrome's debug port listens on 127.0.0.1 only, and refuses a Host header that isn't localhost — so the
 *    container cannot attach to it. For each debug port P (9222, the accounts' ports, Signal's 9339) the bridge listens on
 *    P+1000 (all interfaces, but only for private addresses) and forwards to 127.0.0.1:P with the Host header put right
 *    and the websocket addresses in /json answers pointed back at the bridge. The way in is a secret: every path starts with
 *    /<token>/ (the container is given it) — a page in a browser on this machine cannot guess it.
 *  - POST /<token>/launch {port, urls}: starts the browser for that debug port with its own profile (the same one
 *    scripts/chrome-cdp.mjs starts when Zeff runs on the host: one profile per account).
 *  - The key watcher: a Windows process asking the Configuration Manager for the present USB devices (what the lock
 *    needs; a container does not see USB) → data/lock-state.json, which Zeff's proxy reads on every request.
 *
 * The token lives in data/docker/bridge.json (made on the first start; `docker compose` reads it from there).
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NO_BROWSER_MESSAGE, findBrowser, zeffUserDir } from "./browser-find.mjs";

export const OFFSET = 1000;
export const CONTROL_PORT = 9230;

/** Private networks and loopback: where Docker Desktop's and WSL's traffic comes from. Everything else is refused. */
export function privateAddress(addr) {
  const a = String(addr ?? "").replace(/^::ffff:/i, "");
  if (a === "::1" || /^127\./.test(a)) return true;
  if (/^10\./.test(a) || /^192\.168\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a)) return true;
  return /^f[cd][0-9a-f]{2}:/i.test(a) || /^fe80:/i.test(a);
}

const sameToken = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** "/<token>/rest?query" → "/rest?query", or null when the token is not the first segment. */
export function stripToken(url, token) {
  const m = /^\/([^/?]+)(\/[^]*|\?[^]*)?$/.exec(url ?? "");
  if (!m || !sameToken(decodeURIComponent(m[1]), token)) return null;
  const rest = m[2] ?? "/";
  return rest.startsWith("?") ? `/${rest}` : rest;
}

/** A /json answer for the container: the websocket addresses point at the bridge (with the token in the path). */
export function rewriteDebuggerUrls(text, { chromePort, host, token }) {
  return text.replace(new RegExp(`ws://(?:127\\.0\\.0\\.1|localhost|\\[::1\\]):${chromePort}/`, "g"), `ws://${host}/${token}/`);
}

function proxyServer({ chromePort, token }) {
  const refuse = (res, code, why) => {
    res.writeHead(code, { "content-type": "text/plain" });
    res.end(why);
  };
  const server = http.createServer((req, res) => {
    if (!privateAddress(req.socket.remoteAddress)) return refuse(res, 403, "private networks only");
    const rest = stripToken(req.url, token);
    if (rest === null) return refuse(res, 403, "no");
    const up = http.request({ host: "127.0.0.1", port: chromePort, method: req.method, path: rest, headers: { ...req.headers, host: `127.0.0.1:${chromePort}` } }, (r) => {
      const json = /json/.test(String(r.headers["content-type"] ?? "")) || /^\/json/.test(rest);
      if (!json) {
        res.writeHead(r.statusCode ?? 502, r.headers);
        return void r.pipe(res);
      }
      const chunks = [];
      r.on("data", (c) => chunks.push(c));
      r.on("end", () => {
        const body = rewriteDebuggerUrls(Buffer.concat(chunks).toString("utf8"), { chromePort, host: req.headers.host ?? `localhost:${chromePort + OFFSET}`, token });
        const headers = { ...r.headers, "content-length": Buffer.byteLength(body) };
        delete headers["transfer-encoding"];
        res.writeHead(r.statusCode ?? 502, headers);
        res.end(body);
      });
    });
    up.on("error", () => refuse(res, 502, `nothing answers on 127.0.0.1:${chromePort} — the browser is not running`));
    req.pipe(up);
  });
  server.on("upgrade", (req, socket, head) => {
    const rest = privateAddress(socket.remoteAddress) ? stripToken(req.url, token) : null;
    if (rest === null) return void socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    const up = net.connect(chromePort, "127.0.0.1", () => {
      const headers = Object.entries({ ...req.headers, host: `127.0.0.1:${chromePort}` }).map(([k, v]) => `${k}: ${v}`);
      up.write(`${req.method} ${rest} HTTP/1.1\r\n${headers.join("\r\n")}\r\n\r\n`);
      if (head?.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
    socket.on("close", () => up.destroy());
    up.on("close", () => socket.destroy());
  });
  return server;
}

/**
 * The bridge: a proxy per debug port and the control server. `launch({port, urls})` starts the browser (the tests give their
 * own). Returns { close(), ports } — ports: what listens where.
 */
export async function startBridge({ token, ports, controlPort = CONTROL_PORT, host = "0.0.0.0", offset = OFFSET, launch }) {
  const servers = [];
  const listen = (server, port) =>
    new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => resolve(server.address().port));
    });
  const listening = {};
  for (const p of ports) {
    const s = proxyServer({ chromePort: p, token });
    servers.push(s);
    listening[p] = await listen(s, p + offset);
  }
  const control = http.createServer((req, res) => {
    const end = (code, v) => (res.writeHead(code, { "content-type": "application/json" }), res.end(JSON.stringify(v)));
    if (!privateAddress(req.socket.remoteAddress)) return end(403, { ok: false, error: "private networks only" });
    const rest = stripToken(req.url, token);
    if (rest === null) return end(403, { ok: false });
    if (req.method === "GET" && rest === "/status") return end(200, { ok: true, ports: Object.keys(listening).map(Number), offset });
    if (req.method === "POST" && rest === "/launch") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", async () => {
        try {
          const body = JSON.parse(raw || "{}");
          const port = Number(body.port);
          if (!Number.isInteger(port) || !ports.includes(port)) return end(400, { ok: false, error: `not a debug port of the bridge: ${body.port}` });
          const urls = (Array.isArray(body.urls) ? body.urls : []).filter((u) => /^https?:\/\//.test(String(u))).slice(0, 5);
          await launch({ port, urls });
          end(200, { ok: true });
        } catch (e) {
          end(500, { ok: false, error: String(e?.message ?? e) });
        }
      });
      return;
    }
    end(404, { ok: false });
  });
  servers.push(control);
  const controlAt = await listen(control, controlPort);
  return { controlPort: controlAt, ports: listening, close: () => Promise.all(servers.map((s) => new Promise((r) => (s.close(() => r()), s.closeAllConnections?.())))) };
}

// ---------------------------------------------------------------------------------------------------------------------
// On this computer: which ports, which profile, starting the browser
// ---------------------------------------------------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.ZEFF_DATA_DIR || path.join(here, "..", "data");

/** The debug ports Zeff uses: the first account's 9222, the other accounts' (data/accounts.json), Signal Desktop's 9339. */
export function debugPorts(dataDir = DATA) {
  const ports = new Set([9222, 9339]);
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(dataDir, "accounts.json"), "utf8"));
    for (const a of reg.accounts ?? []) if (Number.isInteger(a.chromePort)) ports.add(a.chromePort);
  } catch {
    // no accounts yet
  }
  return [...ports].sort((a, b) => a - b);
}

/** The profile folder of the browser on a debug port: the first account's as it always was, the others' chrome-<id>. */
export function profileFor(port, dataDir = DATA, userDir = zeffUserDir()) {
  if (port === 9222) return process.env.ZEFF_CHROME_PROFILE?.trim() || path.join(userDir, "chrono-chrome-profile");
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(dataDir, "accounts.json"), "utf8"));
    const a = (reg.accounts ?? []).find((x) => x.chromePort === port);
    if (a) {
      // A copy of another account uses that one's browser (and so its profile).
      const from = a.chromeFrom && a.chromeFrom !== a.id ? (reg.accounts.find((x) => x.id === a.chromeFrom) ?? a) : a;
      return path.join(userDir, `chrome-${from.id}`);
    }
  } catch {
    // unknown account: its own folder by the port
  }
  return path.join(userDir, `chrome-port-${port}`);
}

function launchBrowser({ port, urls }) {
  if (port === 9339) throw new Error("Signal Desktop is started by Zeff's Signal plugin on this computer, not by the bridge.");
  const browser = findBrowser();
  if (!browser) throw new Error(`No browser found for the automation window. ${NO_BROWSER_MESSAGE}`);
  const profile = profileFor(port);
  fs.mkdirSync(profile, { recursive: true });
  const child = spawn(browser.path, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", ...urls], { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

/** The token: kept in data/docker/bridge.json (made once). */
export function bridgeToken(dataDir = DATA) {
  const file = path.join(dataDir, "docker", "bridge.json");
  try {
    const t = JSON.parse(fs.readFileSync(file, "utf8")).token;
    if (typeof t === "string" && t.length >= 24) return t;
  } catch {
    // first start
  }
  const token = crypto.randomBytes(24).toString("hex");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ token, offset: OFFSET, controlPort: CONTROL_PORT }, null, 2), { mode: 0o600 });
  return token;
}

// ---------------------------------------------------------------------------------------------------------------------
// The key watcher (Windows): the same asking as src/lib/lock/detect.ts — written to data/lock-state.json
// ---------------------------------------------------------------------------------------------------------------------

export const USB_COUNT_SCRIPT = (vid) => `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class ZeffUsb {
  [DllImport("cfgmgr32.dll", CharSet=CharSet.Unicode)] static extern int CM_Get_Device_ID_List_SizeW(out uint len, string filter, uint flags);
  [DllImport("cfgmgr32.dll", CharSet=CharSet.Unicode)] static extern int CM_Get_Device_ID_ListW(string filter, char[] buf, uint len, uint flags);
  public static int Count(string vid) {
    uint len; uint flags = 0x1 | 0x100; // by enumerator, present devices only
    if (CM_Get_Device_ID_List_SizeW(out len, "USB", flags) != 0) return -1;
    char[] buf = new char[len];
    if (CM_Get_Device_ID_ListW("USB", buf, len, flags) != 0) return -1;
    int n = 0;
    foreach (string id in new string(buf).Split(new char[]{'\\0'}, StringSplitOptions.RemoveEmptyEntries)) if (id.ToUpper().Contains("VID_" + vid + "&")) n++;
    return n;
  }
}
'@
while ($true) { $n = [ZeffUsb]::Count('${String(vid).toUpperCase()}'); [Console]::Out.WriteLine($n); [Console]::Out.Flush(); Start-Sleep -Milliseconds 500 }
`;

/** The state file as src/lib/lock/shared.ts keeps it: {present, removedAt, beat}. */
export function nextLockState(prev, present, now) {
  const removedAt = !present ? (prev?.present === false ? prev.removedAt : now) : (prev?.removedAt ?? 0);
  return { present, removedAt, beat: now };
}

function watchKey(dataDir = DATA) {
  const lockFile = path.join(dataDir, "lock.json");
  const stateFile = path.join(dataDir, "lock-state.json");
  let vendor = "1050";
  try {
    vendor = JSON.parse(fs.readFileSync(lockFile, "utf8")).vendor || vendor;
  } catch {
    // no lock: nothing to watch for (the state is written anyway — cheap)
  }
  if (process.platform !== "win32") return console.error("[bridge] the key watcher is for Windows; on this system Zeff watches USB itself.");
  let wrote = 0;
  const reading = (present) => {
    const now = Date.now();
    let prev = null;
    try {
      prev = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    } catch {
      // none yet
    }
    if (prev && prev.present === present && now - wrote < 5000) return;
    const tmp = `${stateFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(nextLockState(prev, present, now)));
    fs.renameSync(tmp, stateFile);
    wrote = now;
  };
  const start = () => {
    const script = Buffer.from(USB_COUNT_SCRIPT(vendor), "utf16le").toString("base64");
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", script], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const n = Number(buf.slice(0, i).trim());
        buf = buf.slice(i + 1);
        if (Number.isFinite(n) && n >= 0) reading(n > 0);
      }
    });
    child.on("exit", () => setTimeout(start, 2000));
  };
  start();
}

async function main() {
  const token = bridgeToken();
  const ports = debugPorts();
  const bridge = await startBridge({ token, ports, launch: async ({ port, urls }) => launchBrowser({ port, urls }) });
  console.log(`[bridge] control :${bridge.controlPort} · debug ports ${ports.map((p) => `${p}→${p + OFFSET}`).join(", ")} · the token is in ${path.join(DATA, "docker", "bridge.json")}`);
  if (!process.argv.includes("--no-lock-watch")) watchKey();
  const stop = () => void bridge.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`[bridge] ${e?.message ?? e}`);
    process.exit(1);
  });
}

