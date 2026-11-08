// The whole of Zeff through the companion's WebRTC connection: the app at app.getzeff.com shows Zeff in a frame whose
// every request its service worker hands to the page, and the page sends here — { t: "http", id, method, path,
// headers, body } — to be asked of Zeff's own server like a browser on this computer would. The answer streams back:
// "http-head" (status, headers, cookies), "http-body" parts, "http-end" (or "http-error"); "http-abort" stops one.
//
// Rewritten on the way: Origin and Referer name Zeff's own address (its Server Actions and API routes accept only
// their own pages; the account follows the Referer's prefix), Location back to a path. Kept: Sec-Fetch-Site/Dest as a
// browser sends them — so Zeff's lock still guards the accounts it locks. Only paths of Zeff's own server are asked.
//
// Fast enough for a phone (Zeff's development server sends many megabytes of scripts per page):
// - text (pages, scripts, data, the live events) goes gzipped — "zgz" in the head; flushed per piece, so a stream
//   such as the live events still arrives as it happens;
// - Zeff's own files (/_next/…) carry their SHA-1 ("hash" in the head); the phone keeps them and asks with the one it
//   has ("x-zc-have") — the same one is answered "same" without its body: it's fetched here (fast), not sent there.
const crypto = require("node:crypto");
const zlib = require("node:zlib");

const CHUNK = 32 * 1024; // raw bytes per "http-body" (base64 in JSON stays below the 60 KB parts)
const HIGH_WATER = 1024 * 1024; // bytes waiting in the data channel before a stream waits

const DROP_REQUEST = new Set(["host", "connection", "content-length", "accept-encoding", "transfer-encoding", "upgrade", "keep-alive", "te", "trailer", "proxy-authorization", "authorization", "x-zc-have"]);
const DROP_RESPONSE = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive", "set-cookie", "x-frame-options", "strict-transport-security", "alt-svc", "etag"]);
const COMPRESSIBLE = /^(text\/|application\/(javascript|json|xml|manifest\+json)|image\/svg|text\/x-component)/i;

/** Pieces of a stream, gzipped as they come (each flushed: a slow stream arrives in time). */
async function* gzipped(source) {
  const gz = zlib.createGzip({ level: 5 });
  const out = [];
  let ended = false;
  let failed = null;
  let wake = null;
  gz.on("data", (c) => {
    out.push(c);
    wake?.();
  });
  gz.on("end", () => {
    ended = true;
    wake?.();
  });
  gz.on("error", (e) => {
    failed = e;
    wake?.();
  });
  const pump = (async () => {
    try {
      for await (const v of source) {
        gz.write(v);
        await new Promise((r) => gz.flush(zlib.constants.Z_SYNC_FLUSH, r));
      }
    } catch (e) {
      failed = e;
    }
    gz.end();
  })();
  for (;;) {
    if (out.length) {
      yield out.shift();
      continue;
    }
    if (failed) throw failed;
    if (ended) break;
    await new Promise((r) => (wake = r));
    wake = null;
  }
  await pump;
}

class CompanionProxy {
  /** `zeffUrl`: the server to ask — a string, or a function asked per request (the phone's server comes and goes). */
  constructor({ zeffUrl, log = () => {} }) {
    this.base = typeof zeffUrl === "function" ? zeffUrl : () => zeffUrl;
    this.log = log;
    this.open = new Map(); // `${session id}:${request id}` → AbortController
  }

  /** A session's message: true when it was one of ours. */
  handle(s, msg) {
    if (msg.t === "http") {
      void this.request(s, msg);
      return true;
    }
    if (msg.t === "http-abort") {
      this.open.get(`${s.key}:${msg.id}`)?.abort();
      return true;
    }
    return false;
  }

  /** A session ended: its requests too. */
  closeAll(s) {
    for (const [k, ctl] of this.open) if (k.startsWith(`${s.key}:`)) ctl.abort();
  }

  /** The body's pieces to the phone, at the channel's pace. */
  async send(s, id, ctl, pieces) {
    for await (const value of pieces) {
      for (let at = 0; at < value.length; at += CHUNK) {
        // The phone reads slower than Zeff writes: wait while the channel is full.
        while (s.bufferedAmount() > HIGH_WATER && s.open && !ctl.signal.aborted) await new Promise((r) => setTimeout(r, 10));
        if (!s.open || ctl.signal.aborted) throw new Error("aborted");
        s.send({ t: "http-body", id, d: Buffer.from(value.subarray(at, at + CHUNK)).toString("base64") });
      }
    }
  }

  async request(s, msg) {
    const id = msg.id;
    const key = `${s.key}:${id}`;
    const fail = (message, status = 502) => s.send({ t: "http-error", id, status, message });
    if (typeof msg.path !== "string" || !msg.path.startsWith("/") || msg.path.startsWith("//")) return fail("bad path", 400);
    const ctl = new AbortController();
    this.open.set(key, ctl);
    const zeffUrl = this.base().replace(/\/+$/, "");
    try {
      const headers = new Headers();
      let have = null;
      for (const [k, v] of Object.entries(msg.headers ?? {})) {
        const name = k.toLowerCase();
        if (typeof v !== "string") continue;
        if (name === "x-zc-have") have = v;
        if (DROP_REQUEST.has(name)) continue;
        if (name === "origin") headers.set("origin", zeffUrl);
        else if (name === "referer") {
          try {
            const r = new URL(v);
            headers.set("referer", `${zeffUrl}${r.pathname}${r.search}`);
          } catch {}
        } else headers.set(name, v);
      }
      const method = String(msg.method ?? "GET").toUpperCase();
      const body = msg.body && method !== "GET" && method !== "HEAD" ? Buffer.from(msg.body, "base64") : undefined;
      const res = await fetch(`${zeffUrl}${msg.path}`, { method, headers, body, redirect: "manual", signal: ctl.signal });
      const out = [];
      res.headers.forEach((v, k) => {
        if (DROP_RESPONSE.has(k)) return;
        if (k === "location") out.push([k, v.startsWith(zeffUrl) ? v.slice(zeffUrl.length) || "/" : v]);
        else if (k === "content-security-policy") out.push([k, v.replace(/frame-ancestors[^;]*/i, "frame-ancestors 'self'")]);
        else out.push([k, v]);
      });
      const cookies = res.headers.getSetCookie?.() ?? [];
      const type = res.headers.get("content-type") ?? "";
      const zgz = !!res.body && COMPRESSIBLE.test(type) && ![204, 304].includes(res.status);
      // Zeff's own files: whole (it's local), hashed — the same as the phone's is answered without its body.
      if (method === "GET" && msg.path.startsWith("/_next/") && res.status === 200 && res.body) {
        const buf = Buffer.from(await res.arrayBuffer());
        const hash = crypto.createHash("sha1").update(buf).digest("hex");
        if (have && have === hash) {
          s.send({ t: "http-head", id, status: 200, statusText: "OK", headers: out, cookies, same: true, hash });
        } else {
          s.send({ t: "http-head", id, status: 200, statusText: "OK", headers: out, cookies, zgz, hash });
          await this.send(s, id, ctl, zgz ? gzipped([buf]) : [buf]);
        }
      } else {
        s.send({ t: "http-head", id, status: res.status, statusText: res.statusText, headers: out, cookies, zgz });
        if (res.body) await this.send(s, id, ctl, zgz ? gzipped(res.body) : res.body);
      }
      s.send({ t: "http-end", id });
    } catch (err) {
      if (!ctl.signal.aborted) fail(err.message);
    } finally {
      this.open.delete(key);
    }
  }
}

module.exports = { CompanionProxy, gzipped };
