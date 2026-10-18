import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const ORIGIN = "https://zeff";
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest();
const enc = (b: Buffer) => b.toString("base64url");

test("lock: a session lives while the key stays, ends when it is pulled, and does not come back with it", async () => {
  const { sessionValid, sign: signCookie, newSecret, BEAT_MS, SESSION_MS } = await import("@/lib/lock/shared");
  const cfg = { enabled: true, secret: newSecret() };
  const now = 1_000_000_000_000;
  const iat = now - 5_000;
  const cookie = signCookie(cfg.secret, iat);
  const state = { present: true, removedAt: iat - 1000, beat: now - 1000 };

  assert.equal(sessionValid(cookie, cfg, state, now), true);
  // No cookie, a forged one, one signed with another secret, garbage.
  assert.equal(sessionValid(undefined, cfg, state, now), false);
  assert.equal(sessionValid(signCookie(newSecret(), iat), cfg, state, now), false);
  assert.equal(sessionValid(`${iat}.AAAA`, cfg, state, now), false);
  assert.equal(sessionValid("nonsense", cfg, state, now), false);
  // The key is out, or was pulled after the session began (and is back now): locked either way.
  assert.equal(sessionValid(cookie, cfg, { ...state, present: false }, now), false);
  assert.equal(sessionValid(cookie, cfg, { ...state, removedAt: iat + 1 }, now), false);
  // A watcher that went silent is not trusted; no state at all neither.
  assert.equal(sessionValid(cookie, cfg, { ...state, beat: now - BEAT_MS - 1 }, now), false);
  assert.equal(sessionValid(cookie, cfg, null, now), false);
  // Twelve hours at most.
  assert.equal(sessionValid(cookie, cfg, { ...state, beat: now + SESSION_MS }, now + SESSION_MS), false);
  // A session issued after the key came back is good again.
  assert.equal(sessionValid(signCookie(cfg.secret, now), cfg, { ...state, removedAt: iat + 1 }, now + 1), true);
});

test("lock: the unlock needs the key's PIN (user verification), not only a touch", async () => {
  const touch = await import("@/lib/touch");
  const { id, publicKey } = (() => {
    const kp = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const credId = randomBytes(32);
    const answer = (challenge: string, flags: number, counter: number) => {
      const ad = Buffer.concat([sha256("zeff"), Buffer.from([flags]), Buffer.alloc(4)]);
      ad.writeUInt32BE(counter, 33);
      const cd = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin: ORIGIN, crossOrigin: false }));
      return { id: enc(credId), clientDataJSON: enc(cd), authenticatorData: enc(ad), signature: enc(sign("sha256", Buffer.concat([ad, sha256(cd)]), kp.privateKey)) };
    };
    const regAd = Buffer.concat([sha256("zeff"), Buffer.from([0x41]), Buffer.alloc(4), Buffer.alloc(16), Buffer.from([0, 32]), credId, Buffer.from("a0", "hex")]);
    const regCd = (c: string) => Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: c, origin: ORIGIN, crossOrigin: false }));
    return {
      id: enc(credId),
      publicKey: { answer, reg: (c: string) => ({ id: enc(credId), clientDataJSON: enc(regCd(c)), authenticatorData: enc(regAd), publicKey: enc(kp.publicKey.export({ type: "spki", format: "der" }) as Buffer), algorithm: -7 }) },
    };
  })();

  // No key registered: nothing to unlock with.
  assert.throws(() => touch.beginUnlockAssertion(ORIGIN), /No key is registered/);
  const reg = touch.beginRegistration(ORIGIN);
  touch.finishRegistration(ORIGIN, reg.challenge, publicKey.reg(reg.challenge), "k");
  assert.equal(touch.listCredentials()[0].id, id);

  // Touched but no PIN (UP only): refused. Touched with the PIN (UP + UV): accepted, once.
  const a = touch.beginUnlockAssertion(ORIGIN);
  assert.throws(() => touch.finishUnlockAssertion(ORIGIN, a.challenge, publicKey.answer(a.challenge, 0x01, 1)), /PIN/);
  const b = touch.beginUnlockAssertion(ORIGIN);
  touch.finishUnlockAssertion(ORIGIN, b.challenge, publicKey.answer(b.challenge, 0x05, 2));
  assert.throws(() => touch.finishUnlockAssertion(ORIGIN, b.challenge, publicKey.answer(b.challenge, 0x05, 3)), /expired/);
  // An unlock challenge is no touch approval for an action, and the other way round.
  const c = touch.beginUnlockAssertion(ORIGIN);
  assert.throws(() => touch.finishAssertion(ORIGIN, c.challenge, publicKey.answer(c.challenge, 0x05, 4)), /expired/);
});

test("lock: the private account is not locked — the lock guards the others; the choice is in the lock's file", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { lockOpenFor, activeAccountNow, newSecret } = await import("@/lib/lock/shared");
  const dir = path.dirname(process.env.DATABASE_PATH!);
  const cfg = { enabled: true, secret: newSecret() };
  // Nothing chosen: the account called "privat" stays open, the first one is locked.
  assert.equal(lockOpenFor(cfg, "privat"), true);
  assert.equal(lockOpenFor(cfg, "default"), false);
  assert.equal(lockOpenFor({ ...cfg, openAccounts: [] }, "privat"), false, "an empty choice: every account is locked");
  assert.equal(lockOpenFor({ ...cfg, openAccounts: ["work"] }, "work"), true);
  assert.equal(lockOpenFor({ ...cfg, openAccounts: ["work"] }, "privat"), false);
  // The account in use is the one data/accounts.json says (the Accounts plugin on), else the first.
  fs.writeFileSync(path.join(dir, "accounts.json"), JSON.stringify({ active: "privat", installed: true, accounts: [] }));
  assert.equal(activeAccountNow(), "privat");
  fs.writeFileSync(path.join(dir, "accounts.json"), JSON.stringify({ active: "privat", installed: false, accounts: [] }));
  assert.equal(activeAccountNow(), "default", "without the plugin there is only the first account");
  fs.rmSync(path.join(dir, "accounts.json"));
  assert.equal(activeAccountNow(), "default");
});
