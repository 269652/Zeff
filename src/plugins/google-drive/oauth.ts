/**
 * Signing in to Google with your own OAuth client (authorization code flow with PKCE — Zeff is
 * its own redirect target: /api/google-drive/callback) and keeping the access token fresh.
 * Server only.
 */
import crypto from "node:crypto";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { driveRow, forgetDrive, SCOPE_FILE, SCOPE_FULL, updateDrive } from "./config";

// (The addresses can be pointed elsewhere — the tests' stand-in for Google.)
const authUrl = () => process.env.ZEFF_GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth";
const tokenUrl = () => process.env.ZEFF_GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";

/** What to ask for: who you are (to show it), and — narrowest first — the files Zeff makes, or all of Drive when it should also read what you add. */
export const scopesFor = (full: boolean) => `openid email ${full ? SCOPE_FULL : SCOPE_FILE}`;

const b64url = (b: Buffer) => b.toString("base64url");

export function newPkce(): { verifier: string; challenge: string } {
  const verifier = b64url(crypto.randomBytes(48));
  return { verifier, challenge: b64url(crypto.createHash("sha256").update(verifier).digest()) };
}

export const newState = () => b64url(crypto.randomBytes(24));

export function authorizeUrl(o: { clientId: string; redirectUri: string; state: string; challenge: string; full: boolean }): string {
  const q = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: "code",
    scope: scopesFor(o.full),
    state: o.state,
    code_challenge: o.challenge,
    code_challenge_method: "S256",
    // A refresh token every time (else only the first sign-in gets one), and the account chooser.
    access_type: "offline",
    prompt: "consent select_account",
  });
  return `${authUrl()}?${q}`;
}

type TokenResponse = { access_token?: string; expires_in?: number; refresh_token?: string; scope?: string; id_token?: string; error?: string; error_description?: string };

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(tokenUrl(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(30000),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || json.error) {
    if (json.error === "invalid_grant") throw new Error(t("Google no longer accepts the saved sign-in (revoked — or, for an app still in “Testing”, older than 7 days). Connect again."));
    throw new Error(`${json.error ?? res.status}${json.error_description ? `: ${json.error_description}` : ""}`);
  }
  return json;
}

/** The e-mail address in an id token (to show who is connected) — empty when there's none. */
function emailOf(idToken?: string): string {
  try {
    const payload = JSON.parse(Buffer.from(String(idToken).split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: string };
    return payload.email ?? "";
  } catch {
    return "";
  }
}

/** The code Google sent back, exchanged for tokens — kept. */
export async function exchangeCode(o: { code: string; redirectUri: string; verifier: string }): Promise<void> {
  const row = driveRow();
  if (!row.clientId || !row.clientSecret) throw new Error(t("Set your OAuth client first."));
  const tok = await tokenRequest({ grant_type: "authorization_code", code: o.code, redirect_uri: o.redirectUri, code_verifier: o.verifier, client_id: row.clientId, client_secret: row.clientSecret });
  if (!tok.access_token || !tok.refresh_token) throw new Error(t("Google gave no long-lived sign-in (refresh token) — remove Zeff in your Google account's third-party access and connect again."));
  const email = emailOf(tok.id_token);
  // Another Google account than before: its Drive has none of what Zeff recorded.
  if (row.email && email !== row.email) forgetDrive();
  updateDrive({
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    expiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000,
    scope: tok.scope ?? "",
    email,
    connectedAt: new Date().toISOString(),
  });
}

/** A valid access token — refreshed when it's about to run out (or `force`d, after Drive said 401). */
export async function accessToken(force = false): Promise<string> {
  const row = driveRow();
  if (!row.refreshToken) throw new Error(t("Google Drive isn't connected — connect it on its page."));
  if (!force && row.accessToken && row.expiresAt - Date.now() > 60000) return row.accessToken;
  try {
    const tok = await tokenRequest({ grant_type: "refresh_token", refresh_token: row.refreshToken, client_id: row.clientId, client_secret: row.clientSecret });
    if (!tok.access_token) throw new Error(t("Google gave no access token."));
    updateDrive({ accessToken: tok.access_token, expiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000, ...(tok.scope ? { scope: tok.scope } : {}) });
    return tok.access_token;
  } catch (e) {
    throw new Error(errorMessage(e));
  }
}
