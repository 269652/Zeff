// The companion's own certificate: an ECDSA P-256 key and a self-signed certificate for the WebRTC
// connection with the phone (DTLS). WebRTC trusts no CA — the phone pins this certificate by its SHA-256
// fingerprint, which the pairing QR code carries. So it must stay the same across restarts: made once,
// kept in <data>/launcher/companion/ (key.pem, cert.pem). Node can make the key and sign, but not build a
// certificate — the few DER structures that takes are written here.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function len(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), len(body.length), body]);
};
const seq = (...p) => tlv(0x30, ...p);
const set = (...p) => tlv(0x31, ...p);
function oid(dotted) {
  const [a, b, ...rest] = dotted.split(".").map(Number);
  const out = [40 * a + b];
  for (const n of rest) {
    const chunk = [n & 0x7f];
    for (let v = n >> 7; v > 0; v >>= 7) chunk.unshift(0x80 | (v & 0x7f));
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}
const utcTime = (d) => tlv(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, "").slice(2, 14) + "Z"));

const ECDSA_SHA256 = "1.2.840.10045.4.3.2";
const COMMON_NAME = "2.5.4.3";

/** A self-signed certificate (PEM) for the key, valid from yesterday for `years`. */
function selfSigned(privateKey, publicKey, name = "zeff-companion", years = 20) {
  const serial = crypto.randomBytes(16);
  serial[0] &= 0x7f; // positive
  const alg = seq(oid(ECDSA_SHA256));
  const dn = seq(set(seq(oid(COMMON_NAME), tlv(0x0c, Buffer.from(name, "utf8")))));
  const from = new Date(Date.now() - 24 * 3600 * 1000);
  const to = new Date(from);
  to.setUTCFullYear(Math.min(from.getUTCFullYear() + years, 2049)); // UTCTime ends in 2049
  const spki = publicKey.export({ type: "spki", format: "der" });
  const tbs = seq(tlv(0xa0, tlv(0x02, Buffer.from([2]))), tlv(0x02, serial), alg, dn, seq(utcTime(from), utcTime(to)), dn, spki);
  const signature = crypto.sign("sha256", tbs, privateKey); // DER-encoded ECDSA signature
  const der = seq(tbs, alg, tlv(0x03, Buffer.from([0]), signature));
  return `-----BEGIN CERTIFICATE-----\n${der.toString("base64").match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`;
}

/** The companion's key and certificate in `dir` (made the first time): { keyFile, certFile, fingerprint ("AB:CD:…") }. */
function ensureCert(dir) {
  const keyFile = path.join(dir, "key.pem");
  const certFile = path.join(dir, "cert.pem");
  if (!fs.existsSync(keyFile) || !fs.existsSync(certFile)) {
    fs.mkdirSync(dir, { recursive: true });
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    fs.writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    fs.writeFileSync(certFile, selfSigned(privateKey, publicKey));
  }
  const fingerprint = new crypto.X509Certificate(fs.readFileSync(certFile)).fingerprint256;
  return { keyFile, certFile, fingerprint };
}

module.exports = { ensureCert, selfSigned };
