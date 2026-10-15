/**
 * OAuth (authorization code with PKCE) for the connectors that use a service's API — Zeff is its
 * own redirect target (/api/<service>/callback). A client of your own, so nothing runs through
 * anyone else's account. Server only.
 */
import crypto from "node:crypto";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { clientOf, getConnector, updateConnector, type Provider } from "./store";

export type OAuthEndpoints = {
  authUrl: string;
  tokenUrl: string;
  scope: string;
  /** More query parameters for the sign-in page. */
  extra?: Record<string, string>;
};

const b64url = (b: Buffer) => b.toString("base64url");

export function newPkce(): { verifier: string; challenge: string } {
  const verifier = b64url(crypto.randomBytes(48));
  return { verifier, challenge: b64url(crypto.createHash("sha256").update(verifier).digest()) };
}

export const newState = () => b64url(crypto.randomBytes(24));

export function authorizeUrl(ep: OAuthEndpoints, o: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const q = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: "code",
    scope: ep.scope,
    state: o.state,
    code_challenge: o.challenge,
    code_challenge_method: "S256",
    ...ep.extra,
  });
  return `${ep.authUrl}${ep.authUrl.includes("?") ? "&" : "?"}${q}`;
}

type TokenResponse = { access_token?: string; expires_in?: number; refresh_token?: string; scope?: string; error?: string; error_description?: string };

async function tokenRequest(url: string, body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams(body), signal: AbortSignal.timeout(30000) });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || json.error) {
    if (json.error === "invalid_grant") throw new Error(t("The saved sign-in isn't accepted any more (revoked or expired). Connect again."));
    throw new Error(`${json.error ?? res.status}${json.error_description ? `: ${json.error_description}` : ""}`);
  }
  return json;
}

/** The client's own parameters (a secret only when there is one: a public client signs in with PKCE alone). */
const clientParams = (clientId: string, clientSecret: string) => ({ client_id: clientId, ...(clientSecret ? { client_secret: clientSecret } : {}) });

/** The code the service sent back, exchanged for tokens — kept. */
export async function exchangeCode(service: Provider, ep: OAuthEndpoints, o: { code: string; redirectUri: string; verifier: string }): Promise<void> {
  const client = clientOf(service);
  if (!client.clientId) throw new Error(t("Set your OAuth client first."));
  const tok = await tokenRequest(ep.tokenUrl, { grant_type: "authorization_code", code: o.code, redirect_uri: o.redirectUri, code_verifier: o.verifier, ...clientParams(client.clientId, client.clientSecret) });
  if (!tok.access_token || !tok.refresh_token) throw new Error(t("The service gave no long-lived sign-in (refresh token)."));
  updateConnector(service, { accessToken: tok.access_token, refreshToken: tok.refresh_token, expiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000, scope: tok.scope ?? ep.scope, connectedAt: new Date().toISOString() });
}

/** A valid access token — refreshed when it's about to run out (or `force`d, after a 401). */
export async function accessToken(service: Provider, ep: OAuthEndpoints, force = false): Promise<string> {
  const row = getConnector(service);
  if (!row.refreshToken) throw new Error(t("Not connected — connect it on its page."));
  if (!force && row.accessToken && row.expiresAt - Date.now() > 60000) return row.accessToken;
  try {
    const client = clientOf(service);
    const tok = await tokenRequest(ep.tokenUrl, { grant_type: "refresh_token", refresh_token: row.refreshToken, ...clientParams(client.clientId, client.clientSecret) });
    if (!tok.access_token) throw new Error(t("The service gave no access token."));
    // (Some services rotate the refresh token with every refresh — GitLab does.)
    updateConnector(service, { accessToken: tok.access_token, expiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000, ...(tok.refresh_token ? { refreshToken: tok.refresh_token } : {}) });
    return tok.access_token;
  } catch (e) {
    throw new Error(errorMessage(e));
  }
}
