import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { readConfig, readState, writeState, YUBICO } from "./shared";

/**
 * The key watcher: is a security key plugged into this computer, right now. A browser cannot tell (WebAuthn only answers
 * when asked), the server can — it runs on the same machine. It writes lock-state.json (see shared.ts), which the proxy
 * reads on every request: the moment the key goes, `removedAt` moves and every session ends.
 *
 *   Windows  one PowerShell that lives as long as the server and asks the Configuration Manager (cfgmgr32) for the
 *            present USB devices twice a second — microseconds each, no WMI (a WMI scan takes seconds)
 *   Linux    the idVendor of every USB device under /sys/bus/usb/devices
 *   macOS    ioreg -p IOUSB
 * Server-only. One watcher per process (globalThis: a route and the instrumentation may load this twice).
 */

const BEAT_WRITE_MS = 5000;
const g = globalThis as { __zeffKeyWatch?: { started: boolean; child?: ChildProcess; timer?: NodeJS.Timeout; wrote: number; stop: boolean } };
const watch = (g.__zeffKeyWatch ??= { started: false, wrote: 0, stop: false });

/** Called with every reading. Writes the state file on a change, and now and then as a heartbeat. */
function reading(present: boolean): void {
  const now = Date.now();
  const prev = readState();
  if (prev && prev.present === present && now - watch.wrote < BEAT_WRITE_MS) return;
  // A key that was there and is gone (or never seen after a restart): every session issued before now ends.
  const removedAt = !present ? (prev?.present === false ? prev.removedAt : now) : (prev?.removedAt ?? 0);
  try {
    writeState({ present, removedAt, beat: now });
  } catch (e) {
    console.error("[lock] could not write the key state", e);
  }
  watch.wrote = now;
}

const WINDOWS = (vid: string) => `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class ZeffUsb {
  [DllImport("cfgmgr32.dll", CharSet=CharSet.Unicode)] static extern int CM_Get_Device_ID_List_SizeW(out uint len, string filter, uint flags);
  [DllImport("cfgmgr32.dll", CharSet=CharSet.Unicode)] static extern int CM_Get_Device_ID_ListW(string filter, char[] buf, uint len, uint flags);
  public static int Count(string vid) {
    uint len; uint flags = 0x1 | 0x100; // by enumerator, present devices only
    if (CM_Get_Device_ID_List_SizeW(out len, "USB", flags) != 0) return -1;
    char[] buf = new char[len];
    if (CM_Get_Device_ID_ListW("USB", buf, len, flags) != 0) return -1;
    int n = 0;
    foreach (string id in new string(buf).Split(new char[]{'\\0'}, StringSplitOptions.RemoveEmptyEntries)) if (id.ToUpper().Contains("VID_" + vid + "&")) n++;
    return n;
  }
}
'@
while ($true) { $n = [ZeffUsb]::Count('${vid.toUpperCase()}'); [Console]::Out.WriteLine($n); [Console]::Out.Flush(); Start-Sleep -Milliseconds 500 }
`;

function startWindows(vendor: string): void {
  const script = Buffer.from(WINDOWS(vendor), "utf16le").toString("base64");
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", script], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  watch.child = child;
  let buf = "";
  child.stdout.on("data", (d: Buffer) => {
    buf += d.toString();
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const n = Number(buf.slice(0, i).trim());
      buf = buf.slice(i + 1);
      if (Number.isFinite(n) && n >= 0) reading(n > 0);
    }
  });
  child.stderr.on("data", (d: Buffer) => {
    const text = d.toString().trim();
    if (text && !text.startsWith("#< CLIXML")) console.error("[lock] key watcher:", text.slice(0, 300));
  });
  child.on("exit", () => {
    watch.child = undefined;
    if (!watch.stop) setTimeout(() => startWindows(vendor), 2000); // until it speaks again the proxy treats the lock as shut (stale heartbeat)
  });
  child.on("error", (e) => console.error("[lock] could not start the key watcher", e));
}

function linuxPresent(vendor: string): boolean {
  try {
    return fs.readdirSync("/sys/bus/usb/devices").some((d) => {
      try {
        return fs.readFileSync(`/sys/bus/usb/devices/${d}/idVendor`, "utf8").trim().toLowerCase() === vendor.toLowerCase();
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function macPresent(vendor: string): Promise<boolean> {
  return new Promise((resolve) =>
    execFile("ioreg", ["-p", "IOUSB", "-l", "-w0"], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      // ioreg prints the vendor id in decimal.
      resolve(!err && new RegExp(`"idVendor"\\s*=\\s*${parseInt(vendor, 16)}\\b`).test(out));
    }),
  );
}

/** Start the watcher (once per process). Returns at once; the first reading follows within a second or two. */
export function startKeyWatch(): void {
  if (watch.started) return;
  // In a container (a USB key is not visible there) the host's bridge watches and writes lock-state.json: scripts/chrome-bridge.mjs.
  if (process.env.ZEFF_LOCK_WATCH === "host") return;
  watch.started = true;
  watch.stop = false;
  const vendor = readConfig()?.vendor ?? YUBICO;
  if (process.platform === "win32") return startWindows(vendor);
  const tick = async () => {
    reading(process.platform === "darwin" ? await macPresent(vendor) : linuxPresent(vendor));
  };
  void tick();
  watch.timer = setInterval(() => void tick(), process.platform === "darwin" ? 2000 : 500);
  watch.timer.unref?.();
}

/** Whether the watcher has seen a key within the last seconds (for switching the lock on: no key seen, no lock). */
export async function keyPresentNow(): Promise<boolean> {
  startKeyWatch();
  for (let i = 0; i < 40; i++) {
    const s = readState();
    if (s && Date.now() - s.beat < 6000) return s.present;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
