// The phone companion: Zeff's todos on your phone (the web app at app.getzeff.com, companion/app), over
// WebRTC straight to this PC on the same Wi-Fi — no server in between. Pair a phone by scanning the QR
// code (the status window → Phone): it opens the app with everything it needs to find and trust this PC.
//
// While a phone is connected it sees your todos as they change, and a tick there is done here at once.
// What you tick while away waits on the phone and is sent when it's back home (each change once).
//
// Kept in <data>/launcher/companion/: the certificate (cert.js) and devices.json — the paired phones,
// each with its own secret (unpaired: removed from the list, and its secret no longer opens anything).
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ensureCert } = require("./cert");
const { CompanionHost } = require("./host");

/** The PC's addresses a phone on the same network can reach: private IPv4s first (home Wi-Fi), then the rest (a VPN such as Tailscale). */
function lanAddresses() {
  const all = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== "IPv4" || a.internal || a.address.startsWith("169.254.")) continue;
      // Virtual switches of WSL, Hyper-V, Docker, VirtualBox: no phone is there.
      if (/vEthernet|WSL|Hyper-V|VirtualBox|VMware|docker|br-|veth/i.test(name)) continue;
      all.push(a.address);
    }
  }
  const home = (ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  return [...new Set([...all.filter(home), ...all.filter((ip) => !home(ip))])];
}

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

class Companion {
  /**
   * `zeffUrl`: Zeff's own server (http://127.0.0.1:9333); `dir`: where the companion keeps its files; `ndc`: node-datachannel.
   */
  constructor({ ndc, dir, port, zeffUrl, appUrl, log = () => {}, onChange = () => {} }) {
    this.ndc = ndc;
    this.dir = dir;
    this.port = port;
    this.zeffUrl = zeffUrl.replace(/\/+$/, "");
    this.appUrl = appUrl;
    this.log = log;
    this.onChange = onChange; // the status window shows who's connected
    this.devicesFile = path.join(dir, "devices.json");
    this.sessions = new Set();
    this.events = null;
    this.pushTimer = null;
    this.prefixes = new Map(); // account id → its route in Zeff ("/privat"), from Zeff's answers
  }

  devices() {
    try {
      return JSON.parse(fs.readFileSync(this.devicesFile, "utf8"));
    } catch {
      return [];
    }
  }

  saveDevices(list) {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.devicesFile, JSON.stringify(list, null, 2), { mode: 0o600 });
  }

  start() {
    this.cert = ensureCert(this.dir);
    this.host = new CompanionHost({
      ndc: this.ndc,
      port: this.port,
      cert: this.cert,
      log: this.log,
      secretOf: (id) => {
        const d = this.devices().find((x) => x.id === id);
        return d ? Buffer.from(d.secret, "base64") : null;
      },
    });
    this.host.on("session", (s) => this.attach(s));
    this.host.start();
  }

  stop() {
    for (const s of this.sessions) s.close();
    this.events?.abort();
    this.events = null;
    this.host?.stop();
  }

  /** A new phone to pair: its entry, and the link its QR code opens (with the PC's addresses, the port, the fingerprint, its secret). */
  pair(name = "Phone") {
    const device = { id: crypto.randomUUID(), secret: crypto.randomBytes(32).toString("base64"), name, createdAt: new Date().toISOString(), lastSeen: null };
    this.saveDevices([...this.devices(), device]);
    this.onChange();
    return { device: { id: device.id, name }, url: this.link(device) };
  }

  link(device) {
    // (The fingerprint as base64url of its bytes, not "AB:CD:…": a shorter link is a QR code with fewer, bigger dots.)
    const f = b64url(Buffer.from(this.cert.fingerprint.replace(/:/g, ""), "hex"));
    const payload = { h: lanAddresses(), p: this.port, f, d: device.id, s: device.secret, n: os.hostname() };
    return `${this.appUrl.replace(/#.*$/, "")}#p=${b64url(JSON.stringify(payload))}`;
  }

  /** Unpair: the phone's secret opens nothing any more; it's cut off if connected. */
  unpair(id) {
    this.saveDevices(this.devices().filter((d) => d.id !== id));
    for (const s of this.sessions) if (s.device === id) s.close();
    this.onChange();
  }

  /** For the status window: the paired phones, whether each is connected, the addresses a QR code would carry. */
  status() {
    const live = new Set([...this.sessions].map((s) => s.device));
    return {
      port: this.port,
      addresses: lanAddresses(),
      devices: this.devices().map((d) => ({ id: d.id, name: d.name, createdAt: d.createdAt, lastSeen: d.lastSeen, connected: live.has(d.id) })),
    };
  }

  /**
   * Zeff's /api/companion for an account, under its route ("/privat/api/companion"; null: whichever account Zeff serves
   * unprefixed — the one in use on the PC). → { status, data }. The routes are learned from Zeff's answers (`accounts`).
   */
  async zeff(method, body, account = null) {
    if (account && !this.prefixes.has(account)) await this.zeff("GET").catch(() => {});
    if (account && !this.prefixes.has(account)) return { status: 404, data: { error: "unknown account" } };
    const prefix = account ? this.prefixes.get(account) : "";
    const res = await fetch(`${this.zeffUrl}${prefix}/api/companion`, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json().catch(() => ({}));
    if (Array.isArray(data.accounts)) this.prefixes = new Map(data.accounts.map((a) => [a.id, a.prefix]));
    if (!res.ok && res.status !== 423) throw new Error(data.message ?? data.error ?? `Zeff answered ${res.status}`);
    return { status: res.status, data };
  }

  /** What a phone is sent for an account: its todos, or — when the lock guards it — that it's locked (and the accounts). */
  async snapshotFor(account) {
    const { status, data } = await this.zeff("GET", null, account);
    if (status === 423) return { t: "locked", account, accounts: data.accounts ?? [] };
    if (status !== 200) return { t: "error", re: "sync", message: data.error ?? `Zeff answered ${status}` };
    return { t: "snapshot", ...data };
  }

  attach(s) {
    this.sessions.add(s);
    this.touch(s.device);
    this.log(`companion: phone ${s.device.slice(0, 8)} connected from ${s.remote}`);
    this.follow();
    this.onChange();
    s.on("close", () => {
      this.sessions.delete(s);
      this.touch(s.device);
      this.log(`companion: phone ${s.device.slice(0, 8)} left`);
      if (!this.sessions.size) {
        this.events?.abort();
        this.events = null;
      }
      this.onChange();
    });
    s.on("message", (msg) => this.handle(s, msg).catch((err) => s.send({ t: "error", re: msg?.t, message: err.message })));
  }

  touch(id) {
    const list = this.devices();
    const d = list.find((x) => x.id === id);
    if (!d) return;
    d.lastSeen = new Date().toISOString();
    this.saveDevices(list);
  }

  /**
   * A phone's messages. Each session has its account (`s.account`; null until the phone picks one: the PC's own).
   *   sync {account?}           → snapshot | locked
   *   account {id}              → switch, then snapshot | locked
   *   ops {account?, ops}       → applied {account, results} (in that account — a queue made in another account goes there)
   */
  async handle(s, msg) {
    if (msg.t === "sync" || msg.t === "account") {
      const id = msg.t === "account" ? msg.id : msg.account;
      if (typeof id === "string" && id) s.account = id;
      s.send(await this.snapshotFor(s.account ?? null));
    } else if (msg.t === "ops" && Array.isArray(msg.ops)) {
      const account = typeof msg.account === "string" && msg.account ? msg.account : null;
      const { status, data } = await this.zeff("POST", { ops: msg.ops }, account);
      s.send({ t: "applied", account, results: data.results ?? [], ...(status === 423 ? { locked: true } : {}) });
      // The phones see the result — Zeff's change event would bring it too, a little later.
      this.pushSoon(0);
    }
  }

  /** While a phone is connected: follow Zeff's change events (/api/events) and send every phone the new todos. */
  follow() {
    if (this.events) return;
    const ctl = new AbortController();
    this.events = ctl;
    const run = async () => {
      while (!ctl.signal.aborted) {
        try {
          const res = await fetch(`${this.zeffUrl}/api/events`, { signal: ctl.signal });
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let at;
            while ((at = buf.indexOf("\n\n")) >= 0) {
              const block = buf.slice(0, at);
              buf = buf.slice(at + 2);
              if (/^data: todos$/m.test(block)) this.pushSoon();
            }
          }
        } catch {
          // Zeff restarts, or we stopped following
        }
        if (!ctl.signal.aborted) await new Promise((r) => setTimeout(r, 3000));
      }
    };
    void run();
  }

  /** Send the todos to every connected phone (each its account's), once for a burst of changes. */
  pushSoon(ms = 300) {
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(async () => {
      const byAccount = new Map();
      for (const s of this.sessions) byAccount.set(s.account ?? null, [...(byAccount.get(s.account ?? null) ?? []), s]);
      for (const [account, sessions] of byAccount) {
        try {
          const msg = await this.snapshotFor(account);
          for (const s of sessions) if (s.account === account || (s.account == null && account === null)) s.send(msg);
        } catch (err) {
          this.log(`companion: todos for the phones failed: ${err.message}`);
        }
      }
    }, ms);
  }
}

module.exports = { Companion, lanAddresses };
