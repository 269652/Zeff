import { NextResponse, type NextRequest } from "next/server";
import { getPublicOrigin } from "mcp-handler";
import { exchangeCode } from "@/lib/connectors/oauth";
import { isProvider, PROVIDERS } from "@/lib/connectors/providers";
import { updateConnector } from "@/lib/connectors/store";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";

const cookieName = (provider: string) => `zeff_oauth_${provider}`;

/** GET /api/connectors/:provider/callback?code=…&state=… — the provider sends you back here after you signed in. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isProvider(provider)) return new Response("Unknown provider", { status: 404 });
  const info = PROVIDERS[provider];
  const origin = getPublicOrigin(req);
  const sp = req.nextUrl.searchParams;
  const finish = (query: string) => {
    const res = NextResponse.redirect(new URL(`${info.page}?provider=${provider}&${query}`, origin));
    res.cookies.set(cookieName(provider), "", { path: `/api/connectors/${provider}`, maxAge: 0 });
    return res;
  };
  const fail = (message: string) => finish(`error=${encodeURIComponent(message)}`);

  let cookie: { state?: string; verifier?: string; redirectUri?: string } | null = null;
  try {
    cookie = JSON.parse(req.cookies.get(cookieName(provider))?.value ?? "null");
  } catch {
    cookie = null;
  }
  if (sp.get("error")) return fail(`${sp.get("error")}${sp.get("error_description") ? `: ${sp.get("error_description")}` : ""}`);
  if (!cookie?.state || !cookie.verifier || !cookie.redirectUri || sp.get("state") !== cookie.state) return fail(t("Login state did not match — please try connecting again."));
  const code = sp.get("code");
  if (!code) return fail(t("{provider} did not return an authorization code.", { provider: info.label }));
  try {
    await exchangeCode(provider, info.endpoints(), { code, redirectUri: cookie.redirectUri, verifier: cookie.verifier });
    // Who signed in (to show it): each provider's own read of the user.
    const who = await (await import("@/lib/connectors/who")).whoAmI(provider);
    updateConnector(provider, { account: who });
  } catch (e) {
    return fail(errorMessage(e));
  }
  return finish("connected=1");
}
