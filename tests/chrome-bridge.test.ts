import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import test from "node:test";

/**
 * The bridge between a container and the automation browser on the host: a proxy per debug port that sets Chrome's Host header
 * right, points the websocket addresses back at itself, and lets in only private addresses with the token in the path.
 */
const bridgeModule = import("../scripts/chrome-bridge.mjs");

const TOKEN = "t".repeat(32);

/** A Chrome of its own: /json/version with its websocket address, and an upgrade that answers 101 and then echoes bytes. */
async function fakeChrome() {
  const seen: { host: string; url: string }[] = [];
  const sockets = new Set<net.Socket>();
  const server = http.createServer((req, res) => {
    seen.push({ host: String(req.headers.host), url: req.url ?? "" });
    // Chrome refuses a Host header that is not an IP address or localhost.
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(String(req.headers.host))) {
      res.writeHead(500);
      return void res.end("Host header is specified and is not an IP address or localhost.");
    }
    const port = (server.address() as AddressInfo).port;
    res.writeHead(200, { "content-type": "application/json; charset=UTF-8" });
    res.end(JSON.stringify(req.url?.startsWith("/json/version") ? { Browser: "Chrome/1", webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/abc` } : [{ id: "T1", type: "page", webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/T1` }]));
  });
  server.on("upgrade", (req, socket) => {
    seen.push({ host: String(req.headers.host), url: req.url ?? "" });
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    socket.on("data", (d) => socket.write(d));
    sockets.add(socket as net.Socket);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { port: (server.address() as AddressInfo).port, seen, close: () => (server.close(), server.closeAllConnections(), sockets.forEach((x) => x.destroy())) };
}

const get = (port: number, path: string, host?: string) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path, headers: host ? { host } : {} }, (r) => {
      let body = "";
      r.on("data", (c) => (body += c));
      r.on("end", () => resolve({ status: r.statusCode ?? 0, body }));
    }).on("error", reject);
  });

test("the addresses that may come in: loopback and private networks, nothing else", async () => {
  const { privateAddress } = await bridgeModule;
  for (const ok of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "10.1.2.3", "172.16.0.5", "172.31.255.1", "192.168.65.3", "::ffff:192.168.1.9", "fd12::1", "fe80::1"]) assert.equal(privateAddress(ok), true, ok);
  for (const no of ["8.8.8.8", "172.32.0.1", "172.15.0.1", "100.64.0.1", "2001:db8::1", "", undefined]) assert.equal(privateAddress(no as string), false, String(no));
});

test("the token is the first segment of the path — and only that opens the way", async () => {
  const { stripToken } = await bridgeModule;
  assert.equal(stripToken(`/${TOKEN}/json/version`, TOKEN), "/json/version");
  assert.equal(stripToken(`/${TOKEN}/json/list?x=1`, TOKEN), "/json/list?x=1");
  assert.equal(stripToken(`/${TOKEN}`, TOKEN), "/");
  assert.equal(stripToken("/json/version", TOKEN), null);
  assert.equal(stripToken(`/${"x".repeat(32)}/json/version`, TOKEN), null);
  assert.equal(stripToken("/", TOKEN), null);
});

test("through the bridge: version and list answered, websocket upgrade piped, no token no way, a stopped browser is a 502", async () => {
  const { startBridge } = await bridgeModule;
  const chrome = await fakeChrome();
  // The bridge listens on port + offset: an offset that lands on a free port (tried until one does — other tests hold ports too).
  let bridge: Awaited<ReturnType<typeof startBridge>> | null = null;
  for (let i = 0; i < 10 && !bridge; i++) {
    const offset = 2000 + Math.floor(Math.random() * 20000);
    if (chrome.port + offset > 65000) continue;
    bridge = await startBridge({ token: TOKEN, ports: [chrome.port], host: "127.0.0.1", controlPort: 0, offset, launch: async () => {} }).catch(() => null);
  }
  if (!bridge) throw new Error("no free port for the bridge");
  const at = (bridge!.ports as Record<number, number>)[chrome.port];
  try {
    const v = await get(at, `/${TOKEN}/json/version`, `host.docker.internal:${at}`);
    assert.equal(v.status, 200, v.body);
    const version = JSON.parse(v.body);
    assert.equal(version.webSocketDebuggerUrl, `ws://host.docker.internal:${at}/${TOKEN}/devtools/browser/abc`, "the bridge's own address");
    assert.equal(chrome.seen.at(-1)!.host, `127.0.0.1:${chrome.port}`, "Chrome saw an address it accepts");
    const list = JSON.parse((await get(at, `/${TOKEN}/json/list`, `host.docker.internal:${at}`)).body);
    assert.equal(list[0].webSocketDebuggerUrl, `ws://host.docker.internal:${at}/${TOKEN}/devtools/page/T1`);

    assert.equal((await get(at, "/json/version")).status, 403, "no token");
    assert.equal((await get(at, `/${"z".repeat(32)}/json/version`)).status, 403, "another token");

    // The websocket: the upgrade goes through and what is sent comes back (the fake echoes).
    const echoed = await new Promise<string>((resolve, reject) => {
      const s = net.connect(at, "127.0.0.1", () => s.write(`GET /${TOKEN}/devtools/page/T1 HTTP/1.1\r\nHost: host.docker.internal:${at}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: x\r\nSec-WebSocket-Version: 13\r\n\r\n`));
      let got = "";
      s.on("data", (d) => {
        got += d.toString();
        if (got.includes("101") && !got.includes("PING")) s.write("PING");
        if (got.includes("PING")) {
          s.destroy();
          resolve(got);
        }
      });
      s.on("error", reject);
      setTimeout(() => reject(new Error("no answer")), 4000);
    });
    assert.match(echoed, /101 Switching Protocols/);
    assert.match(echoed, /PING/);
    assert.equal(chrome.seen.at(-1)!.url, "/devtools/page/T1", "the token is not passed on to Chrome");
    assert.equal(chrome.seen.at(-1)!.host, `127.0.0.1:${chrome.port}`);

    // No token on the upgrade: refused.
    const refused = await new Promise<string>((resolve) => {
      const s = net.connect(at, "127.0.0.1", () => s.write(`GET /devtools/page/T1 HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: x\r\nSec-WebSocket-Version: 13\r\n\r\n`));
      let got = "";
      s.on("data", (d) => (got += d.toString()));
      s.on("close", () => resolve(got));
    });
    assert.match(refused, /403/);

    // The browser is stopped: nothing answers on its port.
    chrome.close();
    await new Promise((r) => setTimeout(r, 50));
    const gone = await get(at, `/${TOKEN}/json/version`);
    assert.equal(gone.status, 502);
  } finally {
    await bridge!.close();
  }
});

test("the control server: launch only for the bridge's own ports, only with the token; status says what listens", async () => {
  const { startBridge } = await bridgeModule;
  const launched: { port: number; urls: string[] }[] = [];
  const bridge = await startBridge({ token: TOKEN, ports: [39222], host: "127.0.0.1", controlPort: 0, offset: 1000, launch: async (l: { port: number; urls: string[] }) => void launched.push(l) });
  const post = (path: string, body: unknown) =>
    new Promise<{ status: number; body: { ok: boolean; error?: string } }>((resolve, reject) => {
      const r = http.request({ host: "127.0.0.1", port: bridge.controlPort, path, method: "POST", headers: { "content-type": "application/json" } }, (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(text || "{}") }));
      });
      r.on("error", reject);
      r.end(JSON.stringify(body));
    });
  try {
    assert.equal((await post(`/${TOKEN}/launch`, { port: 39222, urls: ["https://chrono.example/x", "javascript:alert(1)"] })).status, 200);
    assert.deepEqual(launched, [{ port: 39222, urls: ["https://chrono.example/x"] }], "only web addresses");
    assert.equal((await post(`/${TOKEN}/launch`, { port: 9222 })).status, 400, "not a port of the bridge");
    assert.equal((await post("/wrong/launch", { port: 39222 })).status, 403, "no token");
    const status = await get(bridge.controlPort, `/${TOKEN}/status`);
    assert.deepEqual(JSON.parse(status.body).ports, [39222]);
  } finally {
    await bridge.close();
  }
});

test("which ports and which profile: the first account's as always, the others' by their account", async () => {
  const { debugPorts, profileFor, nextLockState } = await bridgeModule;
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-"));
  fs.writeFileSync(path.join(dir, "accounts.json"), JSON.stringify({ active: "default", installed: true, accounts: [{ id: "default" }, { id: "privat", chromePort: 9231 }, { id: "kopie", chromePort: 9232, chromeFrom: "privat" }] }));
  assert.deepEqual(debugPorts(dir), [9222, 9231, 9232, 9339]);
  const user = path.join(dir, "user");
  assert.equal(profileFor(9222, dir, user), path.join(user, "chrono-chrome-profile"));
  assert.equal(profileFor(9231, dir, user), path.join(user, "chrome-privat"));
  assert.equal(profileFor(9232, dir, user), path.join(user, "chrome-privat"), "a copy uses that account's browser");
  assert.equal(profileFor(9300, dir, user), path.join(user, "chrome-port-9300"));
  // The key state, as the lock keeps it: pulled → removedAt moves; still gone → stays; back → removedAt stays.
  assert.deepEqual(nextLockState(null, true, 100), { present: true, removedAt: 0, beat: 100 });
  assert.deepEqual(nextLockState({ present: true, removedAt: 0, beat: 100 }, false, 200), { present: false, removedAt: 200, beat: 200 });
  assert.deepEqual(nextLockState({ present: false, removedAt: 200, beat: 200 }, false, 300), { present: false, removedAt: 200, beat: 300 });
  assert.deepEqual(nextLockState({ present: false, removedAt: 200, beat: 300 }, true, 400), { present: true, removedAt: 200, beat: 400 });
});
