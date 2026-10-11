// The certificate for https://zeff: a "Zeff Local CA" root, whose key is deleted right after it
// signed the server certificate for zeff, knowledge.zeff, their .localhost twins, localhost and
// 127.0.0.1. Kept in <data>/launcher/tls/: zeff-ca.cer (what gets trusted), the CA's thumbprint and
//   Windows        zeff.pfx (+ its password) — made by ps\new-cert.ps1, Windows' own crypto
//   macOS, Linux   zeff.key + zeff.crt — made by the system's openssl
// The server certificate is valid for 825 days (macOS refuses longer ones) and renewed a month before.
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const tls = require("node:tls");
const ps = require("./ps");
const { log } = require("./log");

const WIN = process.platform === "win32";
const RENEW_BEFORE = 30 * 24 * 3600 * 1000;

function files(dir) {
  return {
    pfx: path.join(dir, "zeff.pfx"),
    pass: path.join(dir, "zeff.pfx.pass"),
    key: path.join(dir, "zeff.key"),
    crt: path.join(dir, "zeff.crt"),
    cer: path.join(dir, "zeff-ca.cer"),
    thumb: path.join(dir, "zeff-ca.thumbprint"),
    names: path.join(dir, "names"),
  };
}

const own = (f) => (WIN ? [f.pfx, f.pass] : [f.key, f.crt]);

/** { tls: options for https.createServer, caCer, caThumbprint, serverCrt (macOS, Linux) } */
function load(f) {
  const options = WIN
    ? { pfx: fs.readFileSync(f.pfx), passphrase: fs.readFileSync(f.pass, "utf8").trim() }
    : { key: fs.readFileSync(f.key), cert: fs.readFileSync(f.crt) };
  tls.createSecureContext(options); // throws when Node can't read it
  if (!WIN && Date.parse(new crypto.X509Certificate(options.cert).validTo) - Date.now() < RENEW_BEFORE) throw new Error("it expires soon");
  return { tls: options, caCer: f.cer, caThumbprint: fs.readFileSync(f.thumb, "utf8").trim(), serverCrt: WIN ? null : f.crt };
}

async function createWindows(f, names) {
  const password = crypto.randomBytes(24).toString("hex");
  const r = await ps.script("new-cert.ps1", ["-Dir", path.dirname(f.pfx), "-Password", password, "-Names", names.join(",")]);
  if (r.code !== 0) throw new Error(`Creating the certificate failed: ${r.stderr.trim() || r.stdout.trim()}`);
  fs.writeFileSync(f.pass, password);
  fs.writeFileSync(f.thumb, r.stdout.trim().split(/\r?\n/).pop() ?? "");
}

/** With openssl (LibreSSL on macOS): the CA's key only ever lives in a temp folder, removed at the end. */
async function createOpenssl(f, names) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-ca-"));
  const t = (n) => path.join(tmp, n);
  const openssl = async (...args) => {
    const r = await ps.run("openssl", args);
    if (r.code !== 0) throw new Error(`Creating the certificate failed (openssl ${args[0]}): ${r.stderr.trim() || r.stdout.trim()}`);
  };
  try {
    const san = [...names.map((n) => `DNS:${n}`), "IP:127.0.0.1", "IP:0:0:0:0:0:0:0:1"].join(", ");
    fs.writeFileSync(
      t("openssl.cnf"),
      [
        "[req]",
        "distinguished_name = dn",
        "[dn]",
        "[ca]",
        "basicConstraints = critical, CA:TRUE, pathlen:0",
        "keyUsage = critical, keyCertSign, cRLSign, digitalSignature",
        "subjectKeyIdentifier = hash",
        "[leaf]",
        "basicConstraints = critical, CA:FALSE",
        "keyUsage = critical, digitalSignature, keyEncipherment",
        "extendedKeyUsage = serverAuth",
        `subjectAltName = ${san}`,
        "authorityKeyIdentifier = keyid",
        "",
      ].join("\n"),
    );
    await openssl("genrsa", "-out", t("ca.key"), "2048");
    await openssl("req", "-x509", "-new", "-sha256", "-key", t("ca.key"), "-days", "7300", "-subj", "/CN=Zeff Local CA/O=Zeff (this computer only)", "-config", t("openssl.cnf"), "-extensions", "ca", "-out", t("ca.crt"));
    await openssl("genrsa", "-out", t("leaf.key"), "2048");
    await openssl("req", "-new", "-sha256", "-key", t("leaf.key"), "-subj", "/CN=zeff", "-config", t("openssl.cnf"), "-out", t("leaf.csr"));
    await openssl(
      "x509", "-req", "-sha256", "-in", t("leaf.csr"), "-CA", t("ca.crt"), "-CAkey", t("ca.key"), "-set_serial", `0x${crypto.randomBytes(16).toString("hex")}`,
      "-days", "825", "-extfile", t("openssl.cnf"), "-extensions", "leaf", "-out", t("leaf.crt"),
    );
    fs.copyFileSync(t("leaf.key"), f.key);
    fs.chmodSync(f.key, 0o600);
    fs.copyFileSync(t("leaf.crt"), f.crt);
    fs.copyFileSync(t("ca.crt"), f.cer);
    fs.writeFileSync(f.thumb, new crypto.X509Certificate(fs.readFileSync(f.cer)).fingerprint.replace(/:/g, ""));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** { tls, caCer, caThumbprint, serverCrt } — makes the certificate when it's missing, stale or about to expire. */
async function ensure(dir, names) {
  fs.mkdirSync(dir, { recursive: true });
  const f = files(dir);
  const wanted = names.join(",");
  const have = fs.existsSync(f.names) ? fs.readFileSync(f.names, "utf8").trim() : "";
  if (have === wanted && [...own(f), f.cer, f.thumb].every((p) => fs.existsSync(p))) {
    try {
      return load(f);
    } catch (e) {
      log(`the certificate can't be used (${e.message}) — making a new one`);
    }
  }
  log(`creating the certificate for ${wanted}`);
  await (WIN ? createWindows(f, names) : createOpenssl(f, names));
  fs.writeFileSync(f.names, wanted);
  return load(f);
}

module.exports = { ensure };
