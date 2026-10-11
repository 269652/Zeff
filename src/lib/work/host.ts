import { timingSafeEqual } from "node:crypto";

/**
 * The work host (scripts/work-host.mjs, run by the launcher): workers started there outlive a
 * restart of this server — a deploy — and it tells /api/work/exit when one ends. Without the
 * launcher (npm run dev, no ZEFF_WORK_HOST) or with the host down, the server starts workers
 * itself, as before.
 */
const hostUrl = () => (process.env.ZEFF_WORK_HOST ?? "").replace(/\/$/, "");
const token = () => process.env.ZEFF_WORK_TOKEN ?? "";
const headers = () => ({ "content-type": "application/json", "x-zeff-work-token": token() });

export type HostSpawn = {
  runId: number;
  account: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  stdin: string;
  outFile: string;
  errFile: string;
  /** Keep stdin open for more messages (Claude, stream-json input). */
  live?: boolean;
};

/** The work host answers? (Asked right before each start: it may be restarting.) */
export async function workHostUp(): Promise<boolean> {
  if (!hostUrl()) return false;
  try {
    const r = await fetch(`${hostUrl()}/health`, { headers: headers(), signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Start a worker on the host — its pid. */
export async function spawnOnHost(spec: HostSpawn): Promise<number> {
  const r = await fetch(`${hostUrl()}/spawn`, { method: "POST", headers: headers(), body: JSON.stringify(spec), signal: AbortSignal.timeout(15000) });
  const j = (await r.json().catch(() => ({}))) as { pid?: number; error?: string };
  if (!r.ok || !j.pid) throw new Error(`The work host refused the start: ${j.error ?? r.status}`);
  return j.pid;
}

/** A message into a live run on the host. False: it can't take it (closing, not live, host down). */
export async function sendToHost(runId: number, text: string): Promise<boolean> {
  if (!hostUrl()) return false;
  try {
    const r = await fetch(`${hostUrl()}/message`, { method: "POST", headers: headers(), body: JSON.stringify({ runId, text }), signal: AbortSignal.timeout(5000) });
    return r.ok;
  } catch {
    return false;
  }
}

/** The request comes from the work host (its token)? */
export function fromWorkHost(req: Request): boolean {
  const want = Buffer.from(token());
  const got = Buffer.from(req.headers.get("x-zeff-work-token") ?? "");
  return want.length > 0 && want.length === got.length && timingSafeEqual(want, got);
}
