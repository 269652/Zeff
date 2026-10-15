import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";

/**
 * The server half of WebAuthn, for a security key (a YubiKey) that approves an action by touch. Only what
 * Zeff needs: ES256 keys, no attestation (we don't care which key it is, only that it is the one registered),
 * and the browser hands over the public key (SPKI) itself, so no CBOR is read. Pure — no state, no database.
 */

/** A registered key. `publicKey` is the SPKI DER, base64url; credentials are bound to the page's host (`rpId`). */
export type StoredCredential = { id: string; publicKey: string; rpId: string; label: string; signCount: number; createdAt: string };

const ES256 = -7;
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export const b64u = {
  enc: (b: Uint8Array): string => Buffer.from(b).toString("base64url"),
  dec: (s: string): Buffer => Buffer.from(String(s), "base64url"),
};

export const newChallenge = (): string => b64u.enc(randomBytes(32));

const sha256 = (b: Uint8Array): Buffer => createHash("sha256").update(b).digest();

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The signed client data must be for this ceremony, this challenge and this page. */
function checkClientData(clientDataJSON: Buffer, type: "webauthn.create" | "webauthn.get", challenge: string, origin: string): void {
  let cd: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
  try {
    cd = JSON.parse(clientDataJSON.toString("utf8"));
  } catch {
    throw new Error("The key's answer could not be read.");
  }
  if (cd.type !== type) throw new Error("The key answered a different request.");
  if (typeof cd.challenge !== "string" || !sameBytes(Buffer.from(cd.challenge), Buffer.from(challenge))) throw new Error("The key answered an old or foreign request.");
  if (cd.origin !== origin) throw new Error("The answer came from another page.");
  if (cd.crossOrigin === true) throw new Error("The answer came from an embedded page.");
}

function parseAuthData(authData: Buffer, rpId: string): { flags: number; signCount: number } {
  if (authData.length < 37) throw new Error("The key's answer is too short.");
  if (!sameBytes(authData.subarray(0, 32), sha256(Buffer.from(rpId)))) throw new Error("The key answered for another site.");
  const flags = authData[32];
  if (!(flags & FLAG_UP)) throw new Error("The key was not touched.");
  return { flags, signCount: authData.readUInt32BE(33) };
}

export type RegistrationInput = {
  /** base64url: the credential id, the client data JSON, the authenticator data, the SPKI public key. */
  id: string;
  clientDataJSON: string;
  authenticatorData: string;
  publicKey: string;
  algorithm: number;
};

/** A registration answer, checked: the credential to keep. Throws a readable error. */
export function verifyRegistration(input: RegistrationInput, expect: { challenge: string; origin: string; rpId: string }): { id: string; publicKey: string } {
  if (input.algorithm !== ES256) throw new Error("This key does not offer ES256 (P-256), which Zeff needs.");
  checkClientData(b64u.dec(input.clientDataJSON), "webauthn.create", expect.challenge, expect.origin);
  const authData = b64u.dec(input.authenticatorData);
  const { flags } = parseAuthData(authData, expect.rpId);
  if (!(flags & FLAG_AT) || authData.length < 55) throw new Error("The key sent no credential.");
  // attested credential data: AAGUID (16), id length (2), id.
  const idLen = authData.readUInt16BE(53);
  const credId = authData.subarray(55, 55 + idLen);
  if (!sameBytes(credId, b64u.dec(input.id))) throw new Error("The credential id does not match.");
  const spki = b64u.dec(input.publicKey);
  try {
    const key = createPublicKey({ key: spki, format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("not P-256");
  } catch {
    throw new Error("The key's public key is not a P-256 key.");
  }
  return { id: b64u.enc(credId), publicKey: b64u.enc(spki) };
}

export type AssertionInput = { id: string; clientDataJSON: string; authenticatorData: string; signature: string };

/** An assertion (a touch), checked against the registered key: the new signature counter. Throws a readable error. */
export function verifyAssertion(input: AssertionInput, cred: StoredCredential, expect: { challenge: string; origin: string; userVerified?: boolean }): { signCount: number } {
  if (input.id !== cred.id) throw new Error("This is not the registered key.");
  const clientData = b64u.dec(input.clientDataJSON);
  checkClientData(clientData, "webauthn.get", expect.challenge, expect.origin);
  const authData = b64u.dec(input.authenticatorData);
  const { flags, signCount } = parseAuthData(authData, cred.rpId);
  // The key's own PIN (or fingerprint) was checked on the key — set by the key, inside the signed data.
  if (expect.userVerified && !(flags & FLAG_UV)) throw new Error("The key did not ask for its PIN.");
  const signed = Buffer.concat([authData, sha256(clientData)]);
  const key = createPublicKey({ key: b64u.dec(cred.publicKey), format: "der", type: "spki" });
  if (!verify("sha256", signed, key, b64u.dec(input.signature))) throw new Error("The key's signature is wrong.");
  // A key that counts must count up: a copy of it would not.
  if ((signCount !== 0 || cred.signCount !== 0) && signCount <= cred.signCount) throw new Error("The key's counter went backwards — it may have been cloned.");
  return { signCount };
}
