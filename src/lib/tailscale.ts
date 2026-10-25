import { execFile } from "node:child_process";
import fs from "node:fs";

/**
 * Mobile access through Tailscale (Settings → Mobile access): Zeff stays on this computer — its database, the chats, the syncs — and
 * your phone reaches it in your tailnet, a private network of your own devices (WireGuard, end to end). `tailscale serve` gives it an
 * HTTPS address there (https://<this computer>.<tailnet>.ts.net) that nobody outside your tailnet can open; the gate (src/lib/gate.ts)
 * asks a password of every request that comes that way. Here: is Tailscale there and signed in, is Zeff served, on and off. Server only.
 */

/** Where the CLI is: on the PATH, else where the Windows and macOS installers put it. */
const CANDIDATES = ["tailscale", "C:\\Program Files\\Tailscale\\tailscale.exe", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"];

let found: string | null | undefined;

function run(exe: string, args: string[], timeoutMs = 15000): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(exe, args, { timeout: timeoutMs, windowsHide: true }, (e, out, err) => resolve({ ok: !e, out: String(out ?? ""), err: String(err ?? (e instanceof Error ? e.message : "")) }));
  });
}

async function cli(): Promise<string | null> {
  if (found !== undefined) return found;
  for (const c of CANDIDATES) {
    if (c.includes("/") || c.includes("\\") ? !fs.existsSync(c) : false) continue;
    if ((await run(c, ["version"], 5000)).ok) return (found = c);
  }
  return (found = null);
}

export type TailscaleState = {
  /** The CLI was found. */
  installed: boolean;
  /** Signed in and connected (BackendState Running). */
  running: boolean;
  /** This computer's name in the tailnet ("pc.tail1234.ts.net"). */
  host: string | null;
  /** Zeff is served there: the address your phone opens. */
  url: string | null;
  /** What went wrong, in Tailscale's words. */
  error?: string;
};

/** The port Zeff's pages listen on here (the launcher's 9333, unless PORT says otherwise). */
export const zeffPort = (): number => Number(process.env.PORT) || 9333;

/** The handlers `tailscale serve status --json` shows, flattened: host:port → proxy target. */
export function servedTargets(json: unknown): { host: string; target: string }[] {
  const web = (json as { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> } | null)?.Web ?? {};
  return Object.entries(web).flatMap(([host, v]) => Object.values(v.Handlers ?? {}).flatMap((h) => (h.Proxy ? [{ host, target: h.Proxy }] : [])));
}

/** Whether a proxy target is this Zeff ("http://127.0.0.1:9333", "localhost:9333", "9333"). */
export const isZeffTarget = (target: string, port = zeffPort()): boolean => new RegExp(`(^|[:/])${port}/?$`).test(target.trim());

export async function tailscaleState(): Promise<TailscaleState> {
  const exe = await cli();
  if (!exe) return { installed: false, running: false, host: null, url: null };
  const st = await run(exe, ["status", "--json"]);
  let running = false;
  let host: string | null = null;
  try {
    const j = JSON.parse(st.out) as { BackendState?: string; Self?: { DNSName?: string } };
    running = j.BackendState === "Running";
    host = j.Self?.DNSName?.replace(/\.$/, "") || null;
  } catch {
    return { installed: true, running: false, host: null, url: null, error: (st.err || st.out).trim().slice(0, 300) || undefined };
  }
  if (!running || !host) return { installed: true, running, host, url: null };
  const sv = await run(exe, ["serve", "status", "--json"]);
  let url: string | null = null;
  try {
    const mine = servedTargets(JSON.parse(sv.out || "{}")).find((x) => isZeffTarget(x.target));
    if (mine) url = `https://${mine.host.replace(/:443$/, "")}`;
  } catch {
    // (no serve config: not served)
  }
  return { installed: true, running, host, url };
}

/** Zeff served in the tailnet (HTTPS on 443, in the background — it stays across restarts), or no longer. */
export async function setTailscaleServe(on: boolean): Promise<TailscaleState> {
  const exe = await cli();
  if (!exe) throw new Error("Tailscale isn't installed on this computer.");
  const r = on ? await run(exe, ["serve", "--bg", "--https=443", `http://127.0.0.1:${zeffPort()}`]) : await run(exe, ["serve", "--https=443", "off"]);
  if (!r.ok) throw new Error((r.err || r.out).trim().slice(0, 400) || "Tailscale didn't do it.");
  return tailscaleState();
}
