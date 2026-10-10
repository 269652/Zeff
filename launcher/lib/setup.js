// One-time machine setup for https://zeff, the only part that needs admin rights: the hosts
// entry (`127.0.0.1 zeff knowledge.zeff`) and trusting the Zeff Local CA for the whole computer
// (ps\setup-elevated.ps1, behind a UAC prompt). Declined? The CA is trusted for the current
// user instead (Windows asks once) and Zeff is served on https://zeff.localhost — browsers
// resolve *.localhost without a hosts entry.
const fs = require("node:fs");
const path = require("node:path");
const ps = require("./ps");

const hostsFile = () => path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "drivers", "etc", "hosts");

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

/** The CA is in the computer's or the user's Trusted Root store. */
async function caTrusted(thumbprint) {
  if (!/^[0-9A-F]+$/i.test(thumbprint ?? "")) return false;
  const r = await ps.command(
    `if ((Test-Path 'Cert:\\LocalMachine\\Root\\${thumbprint}') -or (Test-Path 'Cert:\\CurrentUser\\Root\\${thumbprint}')) { exit 0 } else { exit 1 }`,
  );
  return r.code === 0;
}

/** Run the admin part elevated. "done" | "declined" | "failed". */
async function runElevated({ caCer, names, logFile }) {
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(ps.PS_DIR, "setup-elevated.ps1"), "-Cer", caCer, "-Names", names.join(","), "-Log", logFile];
  const argList = args.map((a) => ps.quote(/\s/.test(a) ? `"${a}"` : a)).join(",");
  const r = await ps.command(
    `try { $p = Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList ${argList}; exit $p.ExitCode } catch { exit 1223 }`,
  );
  return r.code === 0 ? "done" : r.code === 1223 ? "declined" : "failed";
}

/** Trust the CA for the current user only — no admin; Windows shows its own confirmation. */
async function trustForUser(caCer) {
  return (await ps.run("certutil.exe", ["-user", "-addstore", "-f", "Root", caCer])).code === 0;
}

module.exports = { hostsOk, caTrusted, runElevated, trustForUser };
