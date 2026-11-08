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

/**
 * The networks Windows calls "public" that a phone would come in on: [{ alias, name, index, addresses }]. Our rule
 * is for private networks only, so on these Windows keeps phones out. Home Wi-Fi is often marked public, as the
 * FRITZ!Box was on 2026-11-08: the phone couldn't connect.
 */
async function publicNetworks() {
  if (!WIN) return [];
  const r = await ps.command(
    "Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq 'Public' } | ForEach-Object { [pscustomobject]@{ alias = $_.InterfaceAlias; name = $_.Name; index = $_.InterfaceIndex; addresses = @((Get-NetIPAddress -InterfaceIndex $_.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).IPAddress) } } | ConvertTo-Json -Compress",
  );
  if (r.code !== 0 || !r.stdout.trim()) return [];
  try {
    const v = JSON.parse(r.stdout);
    return (Array.isArray(v) ? v : [v]).map((n) => ({ alias: n.alias, name: n.name, index: n.index, addresses: [].concat(n.addresses ?? []) }));
  } catch {
    return [];
  }
}

/** Mark a network private (its interface index), elevated: "done" | "declined" | "failed". */
async function makePrivate(index) {
  if (!WIN) return "done";
  const inner = `Set-NetConnectionProfile -InterfaceIndex ${Number(index)} -NetworkCategory Private`;
  const r = await ps.command(
    `try { $p = Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile','-Command',${ps.quote(inner)}; exit $p.ExitCode } catch { exit 1223 }`,
  );
  if (r.code === 1223) return "declined";
  return (await publicNetworks()).some((n) => n.index === Number(index)) ? "failed" : "done";
}

module.exports = { allowed, allow, publicNetworks, makePrivate, RULE };
