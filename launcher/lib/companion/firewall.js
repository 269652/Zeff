// Windows Firewall and the phone companion: phones reach this PC on one UDP port. Windows asks once whether
// Zeff may use the network — a missed or declined prompt leaves phones outside without a word. So the Phone
// tab checks for our own inbound rule (UDP, that port, private networks only — never public Wi-Fi) and offers
// to add it (one UAC prompt). Other systems: nothing to do here (null).
const ps = require("../ps");

const RULE = "Zeff phone companion";
const WIN = process.platform === "win32";

/** Whether our rule lets phones in on `port`: true / false — null where there is no Windows Firewall. */
async function allowed(port) {
  if (!WIN) return null;
  const r = await ps.run("netsh", ["advfirewall", "firewall", "show", "rule", `name=${RULE}`]);
  if (r.code !== 0) return false;
  // (netsh's labels are in the system's language; the values aren't: the port and "UDP" appear as they are.)
  return new RegExp(`\\b${port}\\b`).test(r.stdout) && /\bUDP\b/.test(r.stdout);
}

/** Add (or renew) the rule, elevated. "done" | "declined" | "failed". */
async function allow(port) {
  if (!WIN) return "done";
  const del = `advfirewall firewall delete rule name="${RULE}"`;
  const add = `advfirewall firewall add rule name="${RULE}" dir=in action=allow protocol=UDP localport=${Number(port)} profile=private description="Phones paired in the Zeff launcher reach Zeff over WebRTC (Wi-Fi at home)."`;
  const inner = `netsh ${del} >nul & netsh ${add}`;
  const r = await ps.command(
    `try { $p = Start-Process -FilePath cmd.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList ${ps.quote(`/c ${inner}`)}; exit $p.ExitCode } catch { exit 1223 }`,
  );
  if (r.code === 1223) return "declined";
  return (await allowed(port)) ? "done" : "failed";
}

module.exports = { allowed, allow, RULE };
