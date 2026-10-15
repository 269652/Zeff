import { NextResponse, type NextRequest } from "next/server";
import { getPublicOrigin } from "mcp-handler";
import { authorizeUrl, newPkce, newState } from "@/lib/connectors/oauth";
import { isProvider, PROVIDERS } from "@/lib/connectors/providers";
import { clientOf } from "@/lib/connectors/store";

/** The cookie that carries the sign-in's state and PKCE verifier from here to the callback. */
const cookieName = (provider: string) => `zeff_oauth_${provider}`;

/** GET /api/connectors/:provider/connect — sends you to the provider to sign in (with an OAuth client of your own). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isProvider(provider)) return new Response("Unknown provider", { status: 404 });
  const info = PROVIDERS[provider];
  const row = clientOf(provider);
  const origin = getPublicOrigin(req);
  if (!row.clientId) return NextResponse.redirect(new URL(`${info.page}?provider=${provider}&error=client`, origin));
  const redirectUri = `${origin}/api/connectors/${provider}/callback`;
  const { verifier, challenge } = newPkce();
  const state = newState();
  const res = NextResponse.redirect(authorizeUrl(info.endpoints(), { clientId: row.clientId, redirectUri, state, challenge }));
  res.cookies.set(cookieName(provider), JSON.stringify({ state, verifier, redirectUri }), { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https://"), path: `/api/connectors/${provider}`, maxAge: 600 });
  return res;
}
