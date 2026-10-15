/**
 * Authorized requests to a provider's API (Google, Microsoft Graph) with its OAuth sign-in — the
 * token refreshed once on a 401, one error text for "not connected" / "refused". Server only.
 */
import { t } from "@/lib/i18n/server";
import { accessToken } from "./oauth";
import { PROVIDERS } from "./providers";
import type { Provider } from "./store";

export type ApiResponse<T = unknown> = { status: number; body: T; headers: Headers };

/** The address of an API (the tests' stand-ins can be set in the environment). */
export const apiBase = (provider: "google" | "microsoft"): string =>
  provider === "google" ? process.env.ZEFF_GOOGLE_API_URL || "https://www.googleapis.com" : process.env.ZEFF_GRAPH_URL || "https://graph.microsoft.com/v1.0";

const RATE_RETRIES = 5;
/** The first wait after "too many requests" (doubles each time; the service's Retry-After wins, up to 30 s). */
const retryBaseMs = () => Number(process.env.ZEFF_API_RETRY_MS) || 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Google answers a rate limit with 429, or with 403 and a reason like rateLimitExceeded / userRateLimitExceeded; Graph with 429 / 503. */
function rateLimited(status: number, body: unknown): boolean {
  if (status === 429 || status === 503) return true;
  if (status !== 403) return false;
  const err = (body as { error?: { errors?: { reason?: string }[]; status?: string } })?.error;
  return !!err?.errors?.some((e) => /ratelimit|quotaexceeded/i.test(String(e.reason))) || /rate_?limit/i.test(String(err?.status));
}

/** One request (url absolute, or a path under the provider's API). A 401: the token refreshed, once; a rate limit: waited out and asked again. */
export async function apiRequest<T = unknown>(provider: "google" | "microsoft", pathOrUrl: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}, retried = false, waits = 0): Promise<ApiResponse<T>> {
  const url = /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${apiBase(provider)}${pathOrUrl}`;
  const token = await accessToken(provider as Provider, PROVIDERS[provider].endpoints(), retried);
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(init.body === undefined ? {} : { "content-type": "application/json" }), ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(60000),
  }).catch((e) => {
    throw new Error(t("{host} isn't reachable: {why}", { host: new URL(url).host, why: String((e as Error)?.message ?? e).slice(0, 160) }));
  });
  if (res.status === 401 && !retried) return apiRequest(provider, pathOrUrl, init, true, waits);
  if (res.status === 401) throw new Error(t("{provider} doesn't accept the sign-in (expired or revoked) — connect again on the Connections page.", { provider: PROVIDERS[provider].label }));
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // not JSON: the text stays
  }
  if (rateLimited(res.status, body) && waits < RATE_RETRIES) {
    const asked = Number(res.headers.get("retry-after"));
    await sleep(Math.min(30000, asked > 0 ? asked * 1000 : retryBaseMs() * 2 ** waits));
    return apiRequest(provider, pathOrUrl, init, retried, waits + 1);
  }
  return { status: res.status, body: body as T, headers: res.headers };
}

/** A GET that must work: its body, or an error with the status. */
export async function apiGet<T = unknown>(provider: "google" | "microsoft", pathOrUrl: string, headers?: Record<string, string>): Promise<T> {
  const r = await apiRequest<T>(provider, pathOrUrl, { headers });
  if (r.status < 200 || r.status >= 300) {
    const why = typeof r.body === "string" ? r.body : JSON.stringify((r.body as { error?: unknown })?.error ?? r.body);
    throw new Error(t("{provider} answered {status}: {why}", { provider: PROVIDERS[provider].label, status: r.status, why: String(why).slice(0, 240) }));
  }
  return r.body;
}
