// The whole of Zeff through the companion's WebRTC connection: the app at app.getzeff.com shows Zeff in a frame whose
// every request its service worker hands to the page, and the page sends here — { t: "http", id, method, path,
// headers, body } — to be asked of Zeff's own server like a browser on this computer would. The answer streams back:
// "http-head" (status, headers, cookies), "http-body" parts, "http-end" (or "http-error"); "http-abort" stops one.
//
// Rewritten on the way: Origin and Referer name Zeff's own address (its Server Actions and API routes accept only
// their own pages; the account follows the Referer's prefix), Location back to a path. Kept: Sec-Fetch-Site/Dest as a
// browser sends them — so Zeff's lock still guards the accounts it locks. Only paths of Zeff's own server are asked.
const CHUNK = 32 * 1024; // raw bytes per "http-body" (base64 in JSON stays below the 60 KB parts)
const HIGH_WATER = 1024 * 1024; // bytes waiting in the data channel before a stream waits

const DROP_REQUEST = new Set(["host", "connection", "content-length", "accept-encoding", "transfer-encoding", "upgrade", "keep-alive", "te", "trailer", "proxy-authorization", "authorization"]);
const DROP_RESPONSE = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive", "set-cookie", "x-frame-options", "strict-transport-security", "alt-svc"]);

class CompanionProxy {
  constructor({ zeffUrl, log = () => {} }) {
    this.zeffUrl = zeffUrl.replace(/\/+$/, "");
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

  async request(s, msg) {
    const id = msg.id;
    const key = `${s.key}:${id}`;
    const fail = (message, status = 502) => s.send({ t: "http-error", id, status, message });
    if (typeof msg.path !== "string" || !msg.path.startsWith("/") || msg.path.startsWith("//")) return fail("bad path", 400);
    const ctl = new AbortController();
    this.open.set(key, ctl);
    try {
      const headers = new Headers();
      for (const [k, v] of Object.entries(msg.headers ?? {})) {
        const name = k.toLowerCase();
        if (DROP_REQUEST.has(name) || typeof v !== "string") continue;
        if (name === "origin") headers.set("origin", this.zeffUrl);
        else if (name === "referer") {
          try {
            const r = new URL(v);
            headers.set("referer", `${this.zeffUrl}${r.pathname}${r.search}`);
          } catch {}
        } else headers.set(name, v);
      }
      const method = String(msg.method ?? "GET").toUpperCase();
      const body = msg.body && method !== "GET" && method !== "HEAD" ? Buffer.from(msg.body, "base64") : undefined;
      const res = await fetch(`${this.zeffUrl}${msg.path}`, { method, headers, body, redirect: "manual", signal: ctl.signal });
      const out = [];
      res.headers.forEach((v, k) => {
        if (DROP_RESPONSE.has(k)) return;
        if (k === "location") {
          // Back to a path of the app (Zeff answers with its own address).
          out.push([k, v.startsWith(this.zeffUrl) ? v.slice(this.zeffUrl.length) || "/" : v]);
        } else if (k === "content-security-policy") out.push([k, v.replace(/frame-ancestors[^;]*/i, "frame-ancestors 'self'")]);
        else out.push([k, v]);
      });
      s.send({ t: "http-head", id, status: res.status, statusText: res.statusText, headers: out, cookies: res.headers.getSetCookie?.() ?? [] });
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (let at = 0; at < value.length; at += CHUNK) {
            // The phone reads slower than Zeff writes (a page's scripts): wait while the channel is full.
            while (s.bufferedAmount() > HIGH_WATER && s.open && !ctl.signal.aborted) await new Promise((r) => setTimeout(r, 15));
            if (!s.open || ctl.signal.aborted) throw new Error("aborted");
            s.send({ t: "http-body", id, d: Buffer.from(value.subarray(at, at + CHUNK)).toString("base64") });
          }
        }
      }
      s.send({ t: "http-end", id });
    } catch (err) {
      if (!ctl.signal.aborted) fail(err.message);
    } finally {
      this.open.delete(key);
    }
  }
}

module.exports = { CompanionProxy };
