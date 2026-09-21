import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { CalendarConnection } from "@/db/schema";
import { CALENDAR_SCOPES, DEVICE_CODE_SCOPE, type MicrosoftConfig } from "./config";
import type { GraphEvent } from "./meetings";

const { calendarConnections } = schema;
const PROVIDER = "microsoft";
const GRAPH = "https://graph.microsoft.com/v1.0";

export class CalendarAuthError extends Error {
  readonly name = "CalendarAuthError";
}

// ---------------------------------------------------------------------------
// OAuth 2.0 authorization code flow with PKCE
// ---------------------------------------------------------------------------

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function generateState(): string {
  return base64url(randomBytes(24));
}

function authority(config: MicrosoftConfig): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0`;
}

export function buildAuthorizeUrl(opts: {
  config: MicrosoftConfig;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(`${authority(opts.config)}/authorize`);
  url.searchParams.set("client_id", opts.config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", CALENDAR_SCOPES.join(" "));
  url.searchParams.set("state", opts.state);
  url.searchParams.set("code_challenge", opts.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
};

async function tokenRequest(config: MicrosoftConfig, params: Record<string, string>): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    scope: CALENDAR_SCOPES.join(" "),
    ...params,
  });
  if (config.clientSecret) body.set("client_secret", config.clientSecret);
  const res = await fetch(`${authority(config)}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & {
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new CalendarAuthError(
      `${json.error ?? `HTTP ${res.status}`}: ${json.error_description ?? "token request failed"}`,
    );
  }
  return json as TokenResponse;
}

export function exchangeCode(opts: {
  config: MicrosoftConfig;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  return tokenRequest(opts.config, {
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.codeVerifier,
  });
}

export function refreshTokens(config: MicrosoftConfig, refreshToken: string): Promise<TokenResponse> {
  return tokenRequest(config, { grant_type: "refresh_token", refresh_token: refreshToken });
}

/** Read display claims from the id_token (issued directly by the token endpoint, so not re-verified). */
export function decodeIdToken(idToken?: string): { name?: string; email?: string } {
  if (!idToken) return {};
  try {
    const payload = idToken.split(".")[1];
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    const str = (k: string) => (typeof json[k] === "string" ? (json[k] as string) : undefined);
    return { name: str("name"), email: str("preferred_username") ?? str("email") ?? str("upn") };
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// OAuth 2.0 device authorization flow (no redirect URI, works with a public client)
// ---------------------------------------------------------------------------

export type DeviceCodeStart = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  message?: string;
};

/** Ask Microsoft for a device + user code the person types at https://microsoft.com/devicelogin. */
export async function startDeviceCode(config: MicrosoftConfig): Promise<DeviceCodeStart> {
  const res = await fetch(`${authority(config)}/devicecode`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.clientId, scope: DEVICE_CODE_SCOPE }),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.device_code !== "string") {
    throw new CalendarAuthError(
      `${json.error ?? `HTTP ${res.status}`}: ${json.error_description ?? "device code request failed"}`,
    );
  }
  return {
    deviceCode: json.device_code as string,
    userCode: String(json.user_code ?? ""),
    verificationUri: String(json.verification_uri ?? "https://microsoft.com/devicelogin"),
    expiresIn: Number(json.expires_in ?? 900),
    interval: Number(json.interval ?? 5),
    message: typeof json.message === "string" ? json.message : undefined,
  };
}

export type DevicePollResult =
  | { status: "pending" }
  | { status: "done"; tokens: TokenResponse }
  | { status: "error"; message: string };

/** Poll once for the tokens; "pending" means the person has not finished signing in yet. */
export async function pollDeviceToken(config: MicrosoftConfig, deviceCode: string): Promise<DevicePollResult> {
  const res = await fetch(`${authority(config)}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: config.clientId,
      device_code: deviceCode,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & {
    error?: string;
    error_description?: string;
  };
  if (res.ok && json.access_token) return { status: "done", tokens: json as TokenResponse };
  if (json.error === "authorization_pending" || json.error === "slow_down") return { status: "pending" };
  return {
    status: "error",
    message: `${json.error ?? `HTTP ${res.status}`}: ${json.error_description ?? "device sign-in failed"}`,
  };
}

// ---------------------------------------------------------------------------
// Connection storage (single user → one row per provider)
// ---------------------------------------------------------------------------

export function getConnection(): CalendarConnection | undefined {
  return getDb().select().from(calendarConnections).where(eq(calendarConnections.provider, PROVIDER)).get();
}

export function saveConnection(tokens: TokenResponse, account: { name?: string; email?: string }): void {
  const db = getDb();
  const expiresAt = Date.now() + tokens.expires_in * 1000;
  const existing = getConnection();
  const values = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? existing?.refreshToken ?? null,
    expiresAt,
    scope: tokens.scope ?? null,
    accountName: account.name ?? existing?.accountName ?? null,
    accountEmail: account.email ?? existing?.accountEmail ?? null,
    updatedAt: sql`(CURRENT_TIMESTAMP)`,
  };
  if (existing) {
    db.update(calendarConnections).set(values).where(eq(calendarConnections.id, existing.id)).run();
  } else {
    db.insert(calendarConnections).values({ provider: PROVIDER, ...values }).run();
  }
}

export function deleteConnection(): void {
  getDb().delete(calendarConnections).where(eq(calendarConnections.provider, PROVIDER)).run();
}

/** Access token for Graph, refreshed when it expires within the next minute. */
export async function getValidAccessToken(config: MicrosoftConfig): Promise<string> {
  const conn = getConnection();
  if (!conn) throw new CalendarAuthError("Outlook is not connected.");
  if (conn.expiresAt - 60_000 > Date.now()) return conn.accessToken;
  if (!conn.refreshToken) {
    throw new CalendarAuthError("Session expired and no refresh token available — reconnect Outlook.");
  }
  const tokens = await refreshTokens(config, conn.refreshToken);
  saveConnection(tokens, decodeIdToken(tokens.id_token));
  return tokens.access_token;
}

// ---------------------------------------------------------------------------
// Graph calendar view
// ---------------------------------------------------------------------------

const SELECT = [
  "id", "iCalUId", "subject", "start", "end", "isAllDay", "isCancelled", "showAs",
  "responseStatus", "sensitivity", "isOnlineMeeting", "onlineMeetingProvider",
  "organizer", "location", "webLink",
].join(",");

/**
 * All event occurrences (recurring series expanded by Graph) between two instants,
 * with times expressed in `timeZone`.
 */
export async function fetchCalendarView(
  accessToken: string,
  from: Date,
  to: Date,
  timeZone: string,
): Promise<GraphEvent[]> {
  const url = new URL(`${GRAPH}/me/calendarView`);
  url.searchParams.set("startDateTime", from.toISOString());
  url.searchParams.set("endDateTime", to.toISOString());
  url.searchParams.set("$select", SELECT);
  url.searchParams.set("$orderby", "start/dateTime");
  url.searchParams.set("$top", "250");

  const events: GraphEvent[] = [];
  let next: string | undefined = url.toString();
  for (let page = 0; next && page < 10; page++) {
    const res: Response = await fetch(next, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        prefer: `outlook.timezone="${timeZone}"`,
      },
    });
    if (res.status === 401) throw new CalendarAuthError("Graph rejected the access token — reconnect Outlook.");
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Graph request failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as { value?: GraphEvent[]; "@odata.nextLink"?: string };
    events.push(...(json.value ?? []));
    next = json["@odata.nextLink"];
  }
  return events;
}
