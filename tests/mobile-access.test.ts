import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// Mobile access through Tailscale: a request from the tailnet (serve's user header, a *.ts.net host) is gated like one from a server's
// edge — this computer's own browser isn't; what a phone fetches to add Zeff to its home screen passes; the password set from the
// settings page works with the gate; serve's status read for the address Zeff is served at.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-mobile-"));
process.env.DATABASE_PATH = path.join(dir, "zeff.db");

const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

test("from the tailnet: Tailscale's user header or a *.ts.net host; this computer's own browser not", async () => {
  const { viaTailnet } = await import("../src/lib/gate");
  assert.equal(viaTailnet(headers({ "tailscale-user-login": "me@example.com", host: "127.0.0.1:9333" })), true);
  assert.equal(viaTailnet(headers({ host: "pc.tail1234.ts.net" })), true);
  assert.equal(viaTailnet(headers({ "x-forwarded-host": "pc.tail1234.ts.net", host: "127.0.0.1:9333" })), true);
  assert.equal(viaTailnet(headers({ host: "127.0.0.1:9333" })), false);
  assert.equal(viaTailnet(headers({ host: "localhost:9333" })), false);
  assert.equal(viaTailnet(headers({ host: "evil-ts.net.example.com" })), false);
});

test("the home screen's manifest and icons pass before signing in — even without a password set; the rest is closed", async () => {
  const { gateCheck } = await import("../src/lib/gate");
  const r = (p: string) => gateCheck({ edge: true, path: p, cookie: undefined, authorization: null }, null, Date.now());
  for (const p of ["/manifest.webmanifest", "/icon.svg", "/apple-icon.png", "/android-chrome-192x192.png", "/android-chrome-512x512.png"]) assert.equal(r(p), "pass", p);
  assert.equal(r("/"), "deny", "no password: closed");
});

test("the password set from the settings page: the gate takes it, a new one ends the sessions; too short refused", async () => {
  const { setGatePassword, readGate, verifyPassword, gateCheck, signGate } = await import("../src/lib/gate");
  assert.throws(() => setGatePassword("short"));
  setGatePassword("a long enough one!");
  const cfg = readGate()!;
  assert.ok(verifyPassword("a long enough one!", cfg.password));
  const cookie = signGate(cfg.secret, Date.now() - 1000);
  assert.equal(gateCheck({ edge: true, path: "/", cookie, authorization: null }, cfg, Date.now()), "pass");
  setGatePassword("another long one!");
  assert.equal(gateCheck({ edge: true, path: "/", cookie, authorization: null }, readGate(), Date.now()), "login", "a new password: signed out");
});

test("serve's status: the address Zeff is served at — its port, not another service's", async () => {
  const { servedTargets, isZeffTarget } = await import("../src/lib/tailscale");
  const status = { Web: { "pc.tail1234.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:9333" } } }, "pc.tail1234.ts.net:8443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } } } };
  const mine = servedTargets(status).filter((x) => isZeffTarget(x.target, 9333));
  assert.deepEqual(mine, [{ host: "pc.tail1234.ts.net:443", target: "http://127.0.0.1:9333" }]);
  assert.equal(isZeffTarget("9333", 9333), true);
  assert.equal(isZeffTarget("http://127.0.0.1:19333", 9333), false);
  assert.deepEqual(servedTargets(null), []);
});
