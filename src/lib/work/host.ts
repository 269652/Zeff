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
  /** A live session: open till Zeff closes it (not when it has answered). */
  keep?: boolean;
  /** Its first stream-json lines, as they are (instead of `stdin` as a message). */
  stdinLines?: string[];
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

/** What the running work host can do (its /health): null when it's down. An older host (started before an update) lacks the newer features. */
export async function workHostFeatures(): Promise<string[] | null> {
  if (!hostUrl()) return null;
  try {
    const r = await fetch(`${hostUrl()}/health`, { headers: headers(), signal: AbortSignal.timeout(1500) });
    if (!r.ok) return null;
    const j = (await r.json().catch(() => ({}))) as { features?: unknown };
    return Array.isArray(j.features) ? j.features.filter((f): f is string => typeof f === "string") : [];
  } catch {
    return null;
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

async function post(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; error?: string }> {
  if (!hostUrl()) return { ok: false, status: 0, error: "no work host" };
  try {
    const r = await fetch(`${hostUrl()}${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    return { ok: r.ok, status: r.status, error: j.error };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** One stream-json line into a live session on the host (an answer, an interrupt, a mode switch, a message). */
export async function writeToHost(runId: number, line: string): Promise<void> {
  const r = await post("/write", { runId, line });
  if (!r.ok) throw new Error(r.status === 409 ? "The session is closing." : `The work host didn't take it: ${r.error ?? r.status}`);
}

/** End a live session's input (it finishes and quits). */
export async function closeOnHost(runId: number): Promise<boolean> {
  return (await post("/close", { runId })).ok;
}

/** A run's process and everything it started, gone. */
export async function killOnHost(runId: number): Promise<boolean> {
  return (await post("/kill", { runId })).ok;
}
