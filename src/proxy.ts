import { NextResponse, type NextRequest } from "next/server";
import { lockPage } from "@/lib/lock/page";
import { COOKIE, readConfig, readState, sessionValid } from "@/lib/lock/shared";

/**
 * The lock (Settings → Lock): while it is on and this browser has no live session — the key's PIN and a touch, key still
 * plugged in — every request of a browser gets the lock page (a page load) or a 401 (a fetch, a Server Action). Nothing of
 * Zeff is rendered, nothing is answered.
 *
 * Only a browser is stopped: agents, MCP clients, the launcher and scripts send no Sec-Fetch-* headers (browsers always do,
 * and a page cannot remove them), so they pass — the lock guards the screen, not the machine. /api/lock is the way in.
 */
export function proxy(req: NextRequest) {
  const cfg = readConfig();
  if (!cfg) return NextResponse.next();
  if (req.nextUrl.pathname === "/api/lock") return NextResponse.next();
  if (!req.headers.get("sec-fetch-site")) return NextResponse.next();
  if (sessionValid(req.cookies.get(COOKIE)?.value, cfg, readState(), Date.now())) return NextResponse.next();
  const dest = req.headers.get("sec-fetch-dest");
  const headers = { "cache-control": "no-store", "x-zeff-locked": "1" };
  if (req.method === "GET" && (dest === "document" || dest === "iframe")) return new NextResponse(lockPage(), { status: 401, headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
  return NextResponse.json({ error: "locked", message: "Zeff is locked: unlock it with the security key." }, { status: 401, headers });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
