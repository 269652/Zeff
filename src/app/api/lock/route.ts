import { connection } from "next/server";
import { cookies } from "next/headers";
import { foreignRequest, refused } from "@/lib/request-guard";
import { COOKIE, sessionOk } from "@/lib/lock/shared";

/**
 * The browser's half of the lock (src/lib/lock). GET: {enabled, locked, keyPresent} — all a locked page may learn.
 * POST, one `step`:
 *   unlock-options                 → options for the key (PIN required)
 *   unlock-verify {challenge, …}   → sets the session cookie; with `enable` also switches the lock on
 *   lock-now                       → every session ends (needs a session)
 *   disable                        → the lock is off (needs a session)
 * Only Zeff's own pages (a browser sends the Origin; a script has none and holds no key).
 */
export async function GET() {
  await connection();
  const { lockView } = await import("@/lib/lock");
  return Response.json(lockView((await cookies()).get(COOKIE)?.value), { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  await connection();
  const why = foreignRequest(req);
  if (why) return refused(why);
  const origin = req.headers.get("origin");
  if (!origin || origin === "null") return refused("no origin");
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const lock = await import("@/lib/lock");
    const jar = await cookies();
    const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
    switch (body.step) {
      case "unlock-options":
        return Response.json({ ok: true, options: lock.beginUnlock(origin) });
      case "unlock-verify": {
        const s = await lock.finishUnlock(
          origin,
          str("challenge"),
          { id: str("id"), clientDataJSON: str("clientDataJSON"), authenticatorData: str("authenticatorData"), signature: str("signature") },
          body.enable === true,
        );
        jar.set(COOKIE, s.value, { httpOnly: true, sameSite: "strict", secure: origin.startsWith("https:"), path: "/", maxAge: s.maxAge });
        return Response.json({ ok: true });
      }
      case "lock-now":
        if (!sessionOk(jar.get(COOKIE)?.value)) return Response.json({ ok: false, error: "Locked." }, { status: 401 });
        lock.lockNow();
        jar.delete(COOKIE);
        return Response.json({ ok: true });
      case "disable":
        if (!sessionOk(jar.get(COOKIE)?.value)) return Response.json({ ok: false, error: "Locked." }, { status: 401 });
        lock.disableLock();
        jar.delete(COOKIE);
        return Response.json({ ok: true });
      default:
        return Response.json({ ok: false, error: "Unknown step." }, { status: 400 });
    }
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
