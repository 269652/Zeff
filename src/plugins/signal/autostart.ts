import { execFile } from "node:child_process";
import path from "node:path";
import { SIGNAL_PORT } from "./endpoint";

/**
 * Signal Desktop's autostart with its debug port (Windows, server only): Signal's own entry in
 * HKCU\…\Run ("Open at computer login" — `"…\Signal.exe" --start-in-tray`) with
 * --remote-debugging-port added, so Signal comes up readable for Zeff after every login. Signal
 * writes that entry anew when you change its tray or autostart setting — then it's set up again here.
 */
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const VALUE = "org.whispersystems.signal-desktop";
const FLAG = `--remote-debugging-port=${SIGNAL_PORT}`;

const reg = (args: string[]) =>
  new Promise<{ ok: boolean; out: string }>((resolve) => execFile("reg", args, { windowsHide: true, timeout: 15000 }, (e, out) => resolve({ ok: !e, out: String(out ?? "") })));

export type SignalAutostart = { supported: boolean; entry: string | null; withPort: boolean };

/** Signal's autostart entry now: there or not, with the port or not. */
export async function signalAutostart(): Promise<SignalAutostart> {
  if (process.platform !== "win32") return { supported: false, entry: null, withPort: false };
  const r = await reg(["query", RUN_KEY, "/v", VALUE]);
  const entry = r.ok ? (new RegExp(`${VALUE}\\s+REG_\\w+\\s+(.+)`).exec(r.out)?.[1]?.trim() ?? null) : null;
  return { supported: true, entry, withPort: !!entry && /--remote-debugging-port=\d+/.test(entry) };
}

/**
 * Signal's autostart set to start it with the port (on your click): its entry kept as it is (its
 * Signal.exe, --start-in-tray) with the port added — or, without one, a new one starting it in the tray.
 */
export async function setupSignalAutostart(): Promise<SignalAutostart> {
  const now = await signalAutostart();
  if (!now.supported || now.withPort) return now;
  const exe = process.env.SIGNAL_EXE || path.join(process.env.LOCALAPPDATA || "", "Programs", "signal-desktop", "Signal.exe");
  const entry = now.entry ? `${now.entry} ${FLAG}` : `"${exe}" --start-in-tray ${FLAG}`;
  const r = await reg(["add", RUN_KEY, "/v", VALUE, "/t", "REG_SZ", "/d", entry, "/f"]);
  if (!r.ok) throw new Error(r.out.trim() || "reg add failed");
  return signalAutostart();
}
