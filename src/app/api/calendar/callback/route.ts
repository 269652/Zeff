import { NextResponse, type NextRequest } from "next/server";
import { getMicrosoftConfig } from "@/lib/calendar/config";
import { decodeIdToken, exchangeCode, saveConnection } from "@/lib/calendar/microsoft";
import { OAUTH_COOKIE, parseOAuthCookie } from "@/lib/calendar/oauth-cookie";
import { errorMessage } from "@/lib/errors";

/** GET /api/calendar/callback?code=…&state=… — Microsoft redirects here after login. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const cookie = parseOAuthCookie(req.cookies.get(OAUTH_COOKIE)?.value);

  const finish = (target: string) => {
    const res = NextResponse.redirect(new URL(target, req.url));
    res.cookies.set(OAUTH_COOKIE, "", { path: "/api/calendar", maxAge: 0 });
    return res;
  };
  const fail = (message: string) => finish(`/import?error=${encodeURIComponent(message)}`);

  const config = getMicrosoftConfig();
  if (sp.get("error")) return fail(`${sp.get("error")}: ${sp.get("error_description") ?? ""}`.trim());
  if (!cookie || sp.get("state") !== cookie.state) {
    return fail("Login state did not match — please try connecting again.");
  }
  const code = sp.get("code");
  if (!code) return fail("Microsoft did not return an authorization code.");

  try {
    const tokens = await exchangeCode({
      config,
      code,
      redirectUri: cookie.redirectUri,
      codeVerifier: cookie.verifier,
    });
    saveConnection(tokens, decodeIdToken(tokens.id_token));
  } catch (err) {
    return fail(errorMessage(err));
  }
  return finish(cookie.returnTo);
}
