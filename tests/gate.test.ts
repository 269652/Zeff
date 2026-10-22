import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { gateCheck, hashPassword, hashToken, signGate, verifyPassword, type GateConfig } from "../src/lib/gate";

const cfg = (extra: Partial<GateConfig> = {}): GateConfig => ({ secret: "s".repeat(43), password: hashPassword("correct horse"), tokens: [{ name: "bridge", hash: hashToken("tok-123") }], ...extra });
const NOW = 1_800_000_000_000;
const req = (r: Partial<Parameters<typeof gateCheck>[0]> = {}) => ({ edge: true, path: "/", cookie: undefined, authorization: null, ...r });

test("a request that did not come through the edge (Caddy) passes — the services inside talk to each other", () => {
  assert.equal(gateCheck(req({ edge: false }), cfg(), NOW), "pass");
});

test("from the edge without a session: the login page, or a 401 for the rest", () => {
  assert.equal(gateCheck(req(), cfg(), NOW), "login");
  assert.equal(gateCheck(req({ path: "/api/mcp" }), cfg(), NOW), "login");
});

test("the way in stays open", () => {
  assert.equal(gateCheck(req({ path: "/api/gate" }), cfg(), NOW), "pass");
});

test("a signed, fresh cookie passes; a forged, an old or a future one does not", () => {
  const c = cfg();
  assert.equal(gateCheck(req({ cookie: signGate(c.secret, NOW - 1000) }), c, NOW), "pass");
  assert.equal(gateCheck(req({ cookie: signGate("other".repeat(10), NOW - 1000) }), c, NOW), "login");
  assert.equal(gateCheck(req({ cookie: signGate(c.secret, NOW - 31 * 86_400_000) }), c, NOW), "login");
  assert.equal(gateCheck(req({ cookie: signGate(c.secret, NOW + 3_600_000) }), c, NOW), "login");
  assert.equal(gateCheck(req({ cookie: "garbage" }), c, NOW), "login");
});

test("sessions issued before a 'sign out everywhere' do not pass", () => {
  const c = cfg({ notBefore: NOW - 500 });
  assert.equal(gateCheck(req({ cookie: signGate(c.secret, NOW - 1000) }), c, NOW), "login");
  assert.equal(gateCheck(req({ cookie: signGate(c.secret, NOW - 100) }), c, NOW), "pass");
});

test("a known bearer token passes, an unknown one does not", () => {
  assert.equal(gateCheck(req({ authorization: "Bearer tok-123" }), cfg(), NOW), "pass");
  assert.equal(gateCheck(req({ authorization: "Bearer tok-124" }), cfg(), NOW), "login");
  assert.equal(gateCheck(req({ authorization: "Basic tok-123" }), cfg(), NOW), "login");
});

test("without a config nothing gets in from the edge — not even with a cookie", () => {
  assert.equal(gateCheck(req({ cookie: "1.x" }), null, NOW), "deny");
  assert.equal(gateCheck(req({ path: "/api/gate" }), null, NOW), "deny");
});

test("scripts/gate.mjs writes what the gate reads: the password, a token", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-gate-"));
  const env = { ...process.env, DATABASE_PATH: path.join(dir, "zeff.db") };
  const run = (args: string[], input = "") => spawnSync(process.execPath, ["scripts/gate.mjs", ...args], { env, input, encoding: "utf8" });
  assert.equal(run(["password"], "correct horse battery\n").status, 0);
  assert.notEqual(run(["password"], "short\n").status, 0);
  const token = run(["token", "bridge"]).stdout.trim();
  const c = JSON.parse(fs.readFileSync(path.join(dir, "gate.json"), "utf8")) as GateConfig;
  assert.equal(verifyPassword("correct horse battery", c.password), true);
  assert.equal(gateCheck(req({ authorization: `Bearer ${token}` }), c, NOW), "pass");
  run(["revoke", "bridge"]);
  const after = JSON.parse(fs.readFileSync(path.join(dir, "gate.json"), "utf8")) as GateConfig;
  assert.equal(gateCheck(req({ authorization: `Bearer ${token}` }), after, NOW), "login");
});

test("passwords: scrypt, salted, checked in constant time", () => {
  const h = hashPassword("correct horse");
  assert.notEqual(h, hashPassword("correct horse"));
  assert.equal(verifyPassword("correct horse", h), true);
  assert.equal(verifyPassword("correct hors", h), false);
  assert.equal(verifyPassword("x", "nonsense"), false);
});
