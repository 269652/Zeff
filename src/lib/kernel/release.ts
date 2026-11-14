import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Signed releases (docs/zeff-kernel.md, "How an update arrives"): a plugin's release carries `zeff-release.json` — every file of the
 * folder with its SHA-256, signed with Ed25519 by the publisher's key. Zeff checks it against the public keys the kernel ships with
 * (RELEASE_KEYS), so what comes from a repository is exactly what was released: no file changed, missing or added, whoever can push to
 * the repository. The kernel holds this (lib/kernel/ can't be hooked by mods). Only a kernel update changes the keys.
 *
 * Not signed is allowed, as before: such a plugin comes in switched off and gets only what you grant. A plugin installed signed can't
 * be updated to an unsigned or wrongly signed version. Server only.
 */

export const RELEASE_FILE = "zeff-release.json";

/**
 * The publishers' public keys (Ed25519, PEM), by key id. Empty until a key is made (`npm run release:keygen`): then every release
 * reads as unsigned. `ZEFF_RELEASE_KEYS` (a JSON file { id: pem }) adds keys — for tests and a second machine of the publisher.
 */
export const RELEASE_KEYS: Record<string, string> = {};

export type Release = { format: 1; id: string; version: string; files: Record<string, string>; key: string; signature: string };
export type ReleaseCheck = { status: "signed"; key: string } | { status: "unsigned" } | { status: "bad"; reason: string };

function keys(): Record<string, string> {
  const extra = process.env.ZEFF_RELEASE_KEYS;
  if (!extra) return RELEASE_KEYS;
  try {
    return { ...RELEASE_KEYS, ...(JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ path.resolve(extra), "utf8")) as Record<string, string>) };
  } catch {
    return RELEASE_KEYS;
  }
}

const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

/** What is signed: the id, the version and every file's hash, one per line, sorted — the same on every machine. */
export function releaseText(id: string, version: string, files: Record<string, string>): string {
  return ["zeff-release 1", id, version, ...Object.keys(files).sort().map((rel) => `${files[rel]} ${rel}`)].join("\n") + "\n";
}

/** A release made for these files (the release file itself left out), signed with this private key. */
export function signRelease(id: string, version: string, files: Map<string, Buffer>, privateKeyPem: string, keyId: string): Release {
  const hashes: Record<string, string> = {};
  for (const [rel, buf] of files) if (rel !== RELEASE_FILE) hashes[rel] = sha256(buf);
  const signature = crypto.sign(null, Buffer.from(releaseText(id, version, hashes)), crypto.createPrivateKey(privateKeyPem)).toString("base64");
  return { format: 1, id, version, files: hashes, key: keyId, signature };
}

/** A plugin folder's files (by their path in it) checked against its release file. */
export function checkRelease(files: Map<string, Buffer>, expect: { id: string; version: string }): ReleaseCheck {
  const raw = files.get(RELEASE_FILE);
  if (!raw) return { status: "unsigned" };
  let r: Release;
  try {
    r = JSON.parse(raw.toString("utf8")) as Release;
  } catch {
    return { status: "bad", reason: `${RELEASE_FILE} is not JSON.` };
  }
  if (r?.format !== 1 || typeof r.files !== "object" || !r.files || typeof r.signature !== "string" || typeof r.key !== "string") return { status: "bad", reason: `${RELEASE_FILE} doesn't hold a release.` };
  if (r.id !== expect.id || r.version !== expect.version) return { status: "bad", reason: `The release is of ${r.id} ${r.version}, the folder holds ${expect.id} ${expect.version}.` };
  const pem = keys()[r.key];
  if (!pem) return { status: "bad", reason: `Signed with a key this Zeff doesn't know (“${r.key}”).` };
  let ok = false;
  try {
    ok = crypto.verify(null, Buffer.from(releaseText(r.id, r.version, r.files)), crypto.createPublicKey(pem), Buffer.from(r.signature, "base64"));
  } catch {
    ok = false;
  }
  if (!ok) return { status: "bad", reason: "The signature doesn't match: the release was changed after it was signed." };
  for (const [rel, buf] of files) {
    if (rel === RELEASE_FILE) continue;
    if (!(rel in r.files)) return { status: "bad", reason: `“${rel}” is not part of the release.` };
    if (r.files[rel] !== sha256(buf)) return { status: "bad", reason: `“${rel}” was changed after the release was signed.` };
  }
  for (const rel of Object.keys(r.files)) if (!files.has(rel)) return { status: "bad", reason: `“${rel}” of the release is missing.` };
  return { status: "signed", key: r.key };
}

/** A new key pair for a publisher: the private key to keep (never in a repository), the public one for RELEASE_KEYS. */
export function makeReleaseKey(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return { publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(), privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
}
