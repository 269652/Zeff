// The certificate for https://zeff (made by ps\new-cert.ps1 — Windows' own crypto): a "Zeff
// Local CA" root, whose key is deleted right after it signed the server certificate for zeff,
// knowledge.zeff, their .localhost twins, localhost and 127.0.0.1. Kept in data\launcher\tls\:
// zeff.pfx (+ its password), zeff-ca.cer (what gets trusted) and the CA's thumbprint.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const tls = require("node:tls");
const ps = require("./ps");
const { log } = require("./log");

function files(dir) {
  return {
    pfx: path.join(dir, "zeff.pfx"),
    pass: path.join(dir, "zeff.pfx.pass"),
    cer: path.join(dir, "zeff-ca.cer"),
    thumb: path.join(dir, "zeff-ca.thumbprint"),
    names: path.join(dir, "names"),
  };
}

function load(f) {
  const pfx = fs.readFileSync(f.pfx);
  const passphrase = fs.readFileSync(f.pass, "utf8").trim();
  tls.createSecureContext({ pfx, passphrase }); // throws when Node can't read it
  return { pfx, passphrase, caCer: f.cer, caThumbprint: fs.readFileSync(f.thumb, "utf8").trim() };
}

/** { pfx, passphrase, caCer, caThumbprint } — makes the certificate when it's missing or stale. */
async function ensure(dir, names) {
  fs.mkdirSync(dir, { recursive: true });
  const f = files(dir);
  const wanted = names.join(",");
  const have = fs.existsSync(f.names) ? fs.readFileSync(f.names, "utf8").trim() : "";
  if (have === wanted && [f.pfx, f.pass, f.cer, f.thumb].every((p) => fs.existsSync(p))) {
    try {
      return load(f);
    } catch (e) {
      log(`the certificate can't be read (${e.message}) — making a new one`);
    }
  }
  log(`creating the certificate for ${wanted}`);
  const password = crypto.randomBytes(24).toString("hex");
  const r = await ps.script("new-cert.ps1", ["-Dir", dir, "-Password", password, "-Names", wanted]);
  if (r.code !== 0) throw new Error(`Creating the certificate failed: ${r.stderr.trim() || r.stdout.trim()}`);
  fs.writeFileSync(f.pass, password);
  fs.writeFileSync(f.thumb, r.stdout.trim().split(/\r?\n/).pop() ?? "");
  fs.writeFileSync(f.names, wanted);
  return load(f);
}

module.exports = { ensure };
