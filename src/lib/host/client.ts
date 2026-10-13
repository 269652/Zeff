import { currentAccountId } from "@/db/accounts";
import { hostToken, syncHostUrl } from "./role";

/** The sync host didn't answer (it is restarting, or isn't running): what was asked didn't happen. */
export class HostDownError extends Error {
  constructor(detail?: string) {
    super(`The sync server isn't answering${detail ? ` (${detail})` : ""} — it is restarting or not running (Tray → Sync).`);
  }
}

/**
 * Ask the sync host to do something (see ops.ts) — in the account this runs for. The answer is what the
 * operation returned; what it threw comes back as an Error. `timeoutMs`: how long to wait (a sync waited for: long).
 */
export async function callHost<T>(op: string, args: unknown = {}, timeoutMs = 20000): Promise<T> {
  const url = syncHostUrl();
  if (!url) throw new Error("There is no sync host.");
  let res: Response;
  try {
    res = await fetch(`${url}/api/sync-host`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${hostToken()}` },
      body: JSON.stringify({ op, args, account: currentAccountId() }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (e) {
    throw new HostDownError(e instanceof Error ? e.name : undefined);
  }
  const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; error?: string } | null;
  if (!res.ok || !body?.ok) throw new Error(body?.error ?? `The sync server answered ${res.status}.`);
  return body.result as T;
}
