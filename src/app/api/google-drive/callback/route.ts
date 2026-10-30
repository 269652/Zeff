import { NextResponse, type NextRequest } from "next/server";
import { getPublicOrigin } from "mcp-handler";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { exchangeCode } from "@/plugins/google-drive/oauth";

const DRIVE_COOKIE = "zeff_drive_oauth";

/** GET /api/google-drive/callback?code=…&state=… — Google sends you back here after you signed in. */
export async function GET(req: NextRequest) {
  if (!isInstalled("google-drive")) return new Response("Plugin not installed", { status: 404 });
  const origin = getPublicOrigin(req);
  const sp = req.nextUrl.searchParams;
  const finish = (query: string) => {
    const res = NextResponse.redirect(new URL(`/settings/connections${query}${query ? "&" : "?"}provider=drive#google-drive`, origin));
    res.cookies.set(DRIVE_COOKIE, "", { path: "/api/google-drive", maxAge: 0 });
    return res;
  };
  const fail = (message: string) => finish(`?error=${encodeURIComponent(message)}`);

  let cookie: { state?: string; verifier?: string; redirectUri?: string } | null = null;
  try {
    cookie = JSON.parse(req.cookies.get(DRIVE_COOKIE)?.value ?? "null");
  } catch {
    cookie = null;
  }
  if (sp.get("error")) return fail(`${sp.get("error")}${sp.get("error_description") ? `: ${sp.get("error_description")}` : ""}`);
  if (!cookie?.state || !cookie.verifier || !cookie.redirectUri || sp.get("state") !== cookie.state) return fail(t("Login state did not match — please try connecting again."));
  const code = sp.get("code");
  if (!code) return fail(t("Google did not return an authorization code."));
  try {
    await exchangeCode({ code, redirectUri: cookie.redirectUri, verifier: cookie.verifier });
  } catch (e) {
    return fail(errorMessage(e));
  }
  return finish("?connected=1");
}
