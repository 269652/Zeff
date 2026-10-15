import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const ORIGIN = "https://zeff";
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest();
const enc = (b: Buffer) => b.toString("base64url");

/** A software security key: ES256, a counter, answers like a browser would hand it over. */
function makeKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const credId = randomBytes(32);
  let counter = 0;
  const authData = (flags: number, withCred: boolean, rpId = "zeff") => {
    const head = Buffer.concat([sha256(rpId), Buffer.from([flags]), Buffer.alloc(4)]);
    head.writeUInt32BE(counter, 33);
    if (!withCred) return head;
    const len = Buffer.alloc(2);
    len.writeUInt16BE(credId.length);
    return Buffer.concat([head, Buffer.alloc(16), len, credId, Buffer.from("a0", "hex")]);
  };
  const clientData = (type: string, challenge: string, origin = ORIGIN) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  return {
    id: enc(credId),
    setCounter: (n: number) => (counter = n),
    register(challenge: string, opts: { flags?: number; rpId?: string } = {}) {
      return {
        id: enc(credId),
        clientDataJSON: enc(clientData("webauthn.create", challenge)),
        authenticatorData: enc(authData(opts.flags ?? 0x41, true, opts.rpId)),
        publicKey: enc(publicKey.export({ type: "spki", format: "der" }) as Buffer),
        algorithm: -7,
      };
    },
    assert(challenge: string, opts: { flags?: number; signer?: KeyObject; origin?: string } = {}) {
      counter++;
      const cd = clientData("webauthn.get", challenge, opts.origin);
      const ad = authData(opts.flags ?? 0x01, false);
      const signature = sign("sha256", Buffer.concat([ad, sha256(cd)]), opts.signer ?? privateKey);
      return { id: enc(credId), clientDataJSON: enc(cd), authenticatorData: enc(ad), signature: enc(signature) };
    },
  };
}

test("touch: nothing is asked until a key is registered and the action is switched on", async () => {
  const touch = await import("@/lib/touch");
  assert.equal(touch.touchNeeded("booking-export"), false);
  touch.requireTouch("booking-export", "chrono|2026-10-12"); // no key: a no-op
  assert.equal(touch.beginAssertion("booking-export", "chrono|2026-10-12", ORIGIN), null);
});

test("touch: register, switch on, a touch approves exactly one export of that week", async () => {
  const touch = await import("@/lib/touch");
  const key = makeKey();
  const reg = touch.beginRegistration(ORIGIN);
  assert.equal(reg.rp.id, "zeff");
  touch.finishRegistration(ORIGIN, reg.challenge, key.register(reg.challenge), "YubiKey");
  assert.equal(touch.listCredentials().length, 1);

  // A key is there but the action is not switched on: still nothing asked.
  assert.equal(touch.touchNeeded("booking-export"), false);
  // Settings touch themselves now that a key exists.
  assert.throws(() => touch.setGuarded(["booking-export"]), /Touch your security key/);
  const s = touch.beginAssertion("touch-settings", "", ORIGIN)!;
  touch.finishAssertion(ORIGIN, s.challenge, key.assert(s.challenge));
  touch.setGuarded(["booking-export"]);
  assert.equal(touch.touchNeeded("booking-export"), true);

  // The export is refused without a touch…
  assert.throws(() => touch.requireTouch("booking-export", "chrono|2026-10-12"), /Touch your security key/);
  // …a touch for the week of 14 Oct (typed as a date, or as a week key) approves that week of that system, once.
  const a = touch.beginAssertion("booking-export", "chrono|2026-10-14", ORIGIN)!;
  touch.finishAssertion(ORIGIN, a.challenge, key.assert(a.challenge));
  assert.throws(() => touch.requireTouch("booking-export", "punch|2026-10-12"), /Touch/); // another system
  assert.throws(() => touch.requireTouch("booking-export", "chrono|2026-10-19"), /Touch/); // another week
  touch.requireTouch("booking-export", "chrono|2026-10-12");
  assert.throws(() => touch.requireTouch("booking-export", "chrono|2026-10-12"), /Touch/); // used up
});

test("touch: wrong answers are refused", async () => {
  const { verifyAssertion, verifyRegistration } = await import("@/lib/touch/webauthn");
  const key = makeKey();
  const expectReg = { challenge: "c1", origin: ORIGIN, rpId: "zeff" };
  const reg = verifyRegistration(key.register("c1"), expectReg);
  const cred = { ...reg, rpId: "zeff", label: "k", signCount: 0, createdAt: "" };

  // Registration: another challenge, page, site, no touch, no credential, not P-256.
  assert.throws(() => verifyRegistration(key.register("c1"), { ...expectReg, challenge: "other" }), /old or foreign/);
  assert.throws(() => verifyRegistration(key.register("c1"), { ...expectReg, origin: "https://evil" }), /another page/);
  assert.throws(() => verifyRegistration(key.register("c1", { rpId: "evil" }), expectReg), /another site/);
  assert.throws(() => verifyRegistration(key.register("c1", { flags: 0x40 }), expectReg), /not touched/);
  assert.throws(() => verifyRegistration(key.register("c1", { flags: 0x01 }), expectReg), /no credential/);
  assert.throws(() => verifyRegistration({ ...key.register("c1"), algorithm: -257 }, expectReg), /ES256/);

  // Assertion: the right one passes and counts up; a replayed or older counter does not.
  const good = verifyAssertion(key.assert("c2"), cred, { challenge: "c2", origin: ORIGIN });
  assert.equal(good.signCount, 1);
  assert.throws(() => verifyAssertion(key.assert("c2"), { ...cred, signCount: 5 }, { challenge: "c2", origin: ORIGIN }), /counter/);
  // Another challenge, page, no touch, someone else's signature.
  assert.throws(() => verifyAssertion(key.assert("c2"), cred, { challenge: "c3", origin: ORIGIN }), /old or foreign/);
  assert.throws(() => verifyAssertion(key.assert("c2", { origin: "https://evil" }), cred, { challenge: "c2", origin: ORIGIN }), /another page/);
  assert.throws(() => verifyAssertion(key.assert("c2", { flags: 0 }), cred, { challenge: "c2", origin: ORIGIN }), /not touched/);
  const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey;
  assert.throws(() => verifyAssertion(key.assert("c2", { signer: other }), cred, { challenge: "c2", origin: ORIGIN }), /signature/);
  assert.throws(() => verifyAssertion({ ...key.assert("c2"), id: "nope" }, cred, { challenge: "c2", origin: ORIGIN }), /not the registered/);
});

test("touch: an answer to a challenge the server did not issue (or already used) is refused", async () => {
  const touch = await import("@/lib/touch");
  const key = makeKey();
  const reg = touch.listCredentials()[0];
  assert.ok(reg);
  const a = touch.beginAssertion("touch-settings", "", ORIGIN)!;
  // The key of the earlier test is the one registered; this software key is a stranger.
  assert.throws(() => touch.finishAssertion(ORIGIN, a.challenge, key.assert(a.challenge)), /not a registered key/);
  assert.throws(() => touch.finishAssertion(ORIGIN, a.challenge, key.assert(a.challenge)), /expired/); // the challenge is single-use
  assert.throws(() => touch.finishAssertion(ORIGIN, "made-up", key.assert("made-up")), /expired/);
  // Another page's challenge is not accepted from this one.
  const b = touch.beginAssertion("touch-settings", "", ORIGIN)!;
  assert.throws(() => touch.finishAssertion("https://zeff.localhost", b.challenge, key.assert(b.challenge)), /expired/);
});
