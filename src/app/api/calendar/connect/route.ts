import { NextResponse, type NextRequest } from "next/server";
import { getPublicOrigin } from "mcp-handler";
import { getMicrosoftConfig, hasCustomApp } from "@/lib/calendar/config";
import { buildAuthorizeUrl, generatePkce, generateState } from "@/lib/calendar/microsoft";
import { OAUTH_COOKIE, safeReturnTo } from "@/lib/calendar/oauth-cookie";

/** GET /api/calendar/connect?returnTo=/import?week=… — starts the Microsoft login. */
export async function GET(req: NextRequest) {
  if (!hasCustomApp()) {
    return NextResponse.redirect(new URL("/import?error=use-device-code", req.url));
  }
  const config = getMicrosoftConfig();
  const origin = getPublicOrigin(req);
  const redirectUri = config.redirectUri ?? `${origin}/api/calendar/callback`;
  const { verifier, challenge } = generatePkce();
  const state = generateState();
  const returnTo = safeReturnTo(req.nextUrl.searchParams.get("returnTo"));

  const res = NextResponse.redirect(
    buildAuthorizeUrl({ config, redirectUri, state, codeChallenge: challenge }),
  );
  res.cookies.set(OAUTH_COOKIE, JSON.stringify({ state, verifier, redirectUri, returnTo }), {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/api/calendar",
    maxAge: 600,
  });
  return res;
}
