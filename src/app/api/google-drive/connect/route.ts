import { NextResponse, type NextRequest } from "next/server";
import { getPublicOrigin } from "mcp-handler";
import { isInstalled } from "@/plugins/state";
import { driveRow } from "@/plugins/google-drive/config";
import { authorizeUrl, newPkce, newState } from "@/plugins/google-drive/oauth";

/** The cookie that carries the sign-in's state and PKCE verifier from here to the callback. */
const DRIVE_COOKIE = "zeff_drive_oauth";

/** GET /api/google-drive/connect — sends you to Google to sign in (with your own OAuth client). */
export async function GET(req: NextRequest) {
  if (!isInstalled("google-drive")) return new Response("Plugin not installed", { status: 404 });
  const row = driveRow();
  const origin = getPublicOrigin(req);
  if (!row.clientId || !row.clientSecret) return NextResponse.redirect(new URL("/google-drive?error=client", origin));
  const redirectUri = `${origin}/api/google-drive/callback`;
  const { verifier, challenge } = newPkce();
  const state = newState();
  // All of Drive only when files you add there should come in; else just the files Zeff makes.
  const res = NextResponse.redirect(authorizeUrl({ clientId: row.clientId, redirectUri, state, challenge, full: (await import("@/plugins/google-drive/folders")).needsFullAccess() }));
  res.cookies.set(DRIVE_COOKIE, JSON.stringify({ state, verifier, redirectUri }), { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https://"), path: "/api/google-drive", maxAge: 600 });
  return res;
}
