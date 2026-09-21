/** Short-lived cookie carrying PKCE state between /connect and /callback. */
export const OAUTH_COOKIE = "zeff_oauth";

export type OAuthCookie = {
  state: string;
  verifier: string;
  redirectUri: string;
  returnTo: string;
};

/** Only allow same-site relative paths as post-login destinations. */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/import";
  return value;
}

export function parseOAuthCookie(raw: string | undefined): OAuthCookie | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<OAuthCookie>;
    if (!v.state || !v.verifier || !v.redirectUri) return null;
    return { state: v.state, verifier: v.verifier, redirectUri: v.redirectUri, returnTo: safeReturnTo(v.returnTo) };
  } catch {
    return null;
  }
}
