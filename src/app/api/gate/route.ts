import { connection } from "next/server";
import { cookies } from "next/headers";
import { GATE_COOKIE, GATE_SESSION_MS, readGate, signGate, verifyPassword } from "@/lib/gate";

/**
 * The gate's way in (src/lib/gate.ts). POST {password} → the session cookie; POST {logout: true} → the cookie gone. At most ten
 * wrong passwords per address in fifteen minutes (the edge passes the client's address on in x-forwarded-for).
 */
const tries = new Map<string, number[]>();
const WINDOW = 15 * 60_000;
const MAX = 10;

export async function POST(req: Request) {
  await connection();
  const cfg = readGate();
  if (!cfg) return Response.json({ ok: false }, { status: 403 });
  const jar = await cookies();
  const body = (await req.json().catch(() => ({}))) as { password?: unknown; logout?: unknown };
  if (body.logout === true) {
    jar.delete(GATE_COOKIE);
    return Response.json({ ok: true });
  }
  const who = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const recent = (tries.get(who) ?? []).filter((t) => now - t < WINDOW);
  if (recent.length >= MAX) return Response.json({ ok: false }, { status: 429 });
  if (typeof body.password !== "string" || !verifyPassword(body.password, cfg.password)) {
    tries.set(who, [...recent, now]);
    await new Promise((r) => setTimeout(r, 500));
    return Response.json({ ok: false }, { status: 401 });
  }
  tries.delete(who);
  jar.set(GATE_COOKIE, signGate(cfg.secret, now), { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: GATE_SESSION_MS / 1000 });
  return Response.json({ ok: true });
}
