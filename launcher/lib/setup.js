// One-time machine setup for https://zeff, the only part that needs admin rights: the hosts
// entry (`127.0.0.1 zeff knowledge.zeff`) and trusting the Zeff Local CA. Declined? The CA is
// trusted for the current user only and Zeff is served on https://127.0.0.1:1337.
//
//   Windows  ps\setup-elevated.ps1 behind a UAC prompt: hosts + the computer's Root store;
//            per user: certutil -user (Windows asks once)
//   macOS    ps/setup-elevated.sh via osascript (the password dialog): hosts; the CA goes in the
//            login keychain as the user (macOS asks for the password — root can't set trust
//            without the user's interaction)
//   Linux    ps/setup-elevated.sh via pkexec: hosts + the system store (curl, Node, …);
//            browsers read the user's NSS database (~/.pki/nssdb), which needs certutil
//            (libnss3-tools) — without it the browser warns
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ps = require("./ps");
const { log } = require("./log");

const PLATFORM = process.platform;
const CA_NAME = "Zeff Local CA";
const NSSDB = () => `sql:${path.join(os.homedir(), ".pki", "nssdb")}`;

const hostsFile = () => (PLATFORM === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "drivers", "etc", "hosts") : "/etc/hosts");

/** Every name maps to a loopback address in the hosts file. */
function hostsOk(names) {
  let text;
  try {
    text = fs.readFileSync(hostsFile(), "latin1");
  } catch {
    return false;
  }
  const entries = text.split(/\r?\n/).map((l) => l.split("#")[0].trim().split(/\s+/));
  return names.every((n) => entries.some(([ip, ...hosts]) => (ip === "127.0.0.1" || ip === "::1") && hosts.some((h) => h.toLowerCase() === n)));
}

/** The SHA-1 thumbprint of a PEM/DER certificate, or null. */
const thumbprintOf = (data) => {
  try {
    return new crypto.X509Certificate(data).fingerprint.replace(/:/g, "");
  } catch {
    return null;
  }
};

/** The browser trusts the CA: { caThumbprint, caCer, serverCrt } as from tls.ensure. */
async function caTrusted({ caThumbprint, serverCrt }) {
  if (!/^[0-9A-F]+$/i.test(caThumbprint ?? "")) return false;
  if (PLATFORM === "win32") {
    const r = await ps.command(
      `if ((Test-Path 'Cert:\\LocalMachine\\Root\\${caThumbprint}') -or (Test-Path 'Cert:\\CurrentUser\\Root\\${caThumbprint}')) { exit 0 } else { exit 1 }`,
    );
    return r.code === 0;
  }
  if (PLATFORM === "darwin") {
    // What Safari and Chrome check: the server certificate against the keychains' trust settings.
    return (await ps.run("security", ["verify-cert", "-c", serverCrt, "-p", "ssl", "-L", "-q"])).code === 0;
  }
  const r = await ps.run("certutil", ["-d", NSSDB(), "-L", "-n", CA_NAME, "-a"]);
  return r.code === 0 && thumbprintOf(r.stdout)?.toUpperCase() === caThumbprint.toUpperCase();
}

/** Run the admin part elevated. "done" | "declined" | "failed". */
async function runElevated({ caCer, names, logFile }) {
  if (PLATFORM === "win32") {
    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(ps.PS_DIR, "setup-elevated.ps1"), "-Cer", caCer, "-Names", names.join(","), "-Log", logFile];
    const argList = args.map((a) => ps.quote(/\s/.test(a) ? `"${a}"` : a)).join(",");
    const r = await ps.command(
      `try { $p = Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList ${argList}; exit $p.ExitCode } catch { exit 1223 }`,
    );
    return r.code === 0 ? "done" : r.code === 1223 ? "declined" : "failed";
  }
  const script = path.join(ps.PS_DIR, "setup-elevated.sh");
  const sh = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  let r;
  if (PLATFORM === "darwin") {
    const cmd = `/bin/sh ${sh(script)} ${sh(names.join(","))}`;
    r = await ps.run("osascript", ["-e", `do shell script "${cmd.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}" with administrator privileges`]);
    if (r.code !== 0 && /-128/.test(r.stderr)) return "declined";
  } else {
    r = await ps.run("pkexec", ["/bin/sh", script, names.join(","), caCer]);
    if (r.code === 126) return "declined";
  }
  for (const line of `${r.stdout}\n${r.stderr}`.split("\n")) if (line.trim()) log(`[setup] ${line.trim()}`);
  return r.code === 0 ? "done" : "failed";
}

/** Trust the CA for the current user only — no admin; the system shows its own confirmation. */
async function trustForUser(caCer) {
  if (PLATFORM === "win32") return (await ps.run("certutil.exe", ["-user", "-addstore", "-f", "Root", caCer])).code === 0;
  if (PLATFORM === "darwin") {
    const keychain = path.join(os.homedir(), "Library", "Keychains", "login.keychain-db");
    return (await ps.run("security", ["add-trusted-cert", "-r", "trustRoot", "-p", "ssl", "-k", keychain, caCer])).code === 0;
  }
  const dir = path.join(os.homedir(), ".pki", "nssdb");
  if (!fs.existsSync(path.join(dir, "cert9.db"))) {
    fs.mkdirSync(dir, { recursive: true });
    const r = await ps.run("certutil", ["-d", NSSDB(), "-N", "--empty-password"]);
    if (r.code !== 0) {
      log(`setup: no certutil (${r.stderr.trim() || `exit ${r.code}`}) — install libnss3-tools so browsers trust https://zeff`);
      return false;
    }
  }
  await ps.run("certutil", ["-d", NSSDB(), "-D", "-n", CA_NAME]); // an earlier CA
  return (await ps.run("certutil", ["-d", NSSDB(), "-A", "-t", "C,,", "-n", CA_NAME, "-i", caCer])).code === 0;
}

module.exports = { hostsOk, caTrusted, runElevated, trustForUser };
