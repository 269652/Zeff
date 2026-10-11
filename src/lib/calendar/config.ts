/**
 * Microsoft-published "Microsoft Graph Command Line Tools" public client. It is a
 * pre-registered multi-tenant public client that supports the device-code flow, so
 * Zeff can read your calendar without you registering your own app in Entra.
 * (This is the same client id the Microsoft.Graph PowerShell module / Connect-MgGraph use.)
 */
export const PUBLIC_GRAPH_CLI_CLIENT_ID = "14d82eec-204b-4c2f-b7e8-296a70dab67e";

/** Auth-code (redirect) flow scopes — used only when you bring your own app registration. */
export const CALENDAR_SCOPES = ["openid", "profile", "offline_access", "Calendars.Read"];

/** Device-code flow scope (resource-qualified, matches what the tenant was probed with). */
export const DEVICE_CODE_SCOPE = "https://graph.microsoft.com/Calendars.Read offline_access openid profile";

export type MicrosoftConfig = {
  clientId: string;
  tenantId: string;
  clientSecret?: string;
  /** Explicit redirect URI; defaults to <origin>/api/calendar/callback of the incoming request. */
  redirectUri?: string;
  /** True when falling back to the shared public client (device code only, no secret, no redirect flow). */
  usesPublicClient: boolean;
};

/** True when a custom app registration is configured (enables the redirect flow). */
export function hasCustomApp(): boolean {
  return Boolean(process.env.MS_CLIENT_ID?.trim());
}

/**
 * The effective Microsoft app config. Always returns something: a custom app when
 * MS_CLIENT_ID is set, otherwise the shared public client for the device-code flow.
 */
export function getMicrosoftConfig(): MicrosoftConfig {
  const custom = process.env.MS_CLIENT_ID?.trim();
  const tenantId = process.env.MS_TENANT_ID?.trim() || "organizations";
  if (custom) {
    return {
      clientId: custom,
      tenantId,
      clientSecret: process.env.MS_CLIENT_SECRET?.trim() || undefined,
      redirectUri: process.env.MS_REDIRECT_URI?.trim() || undefined,
      usesPublicClient: false,
    };
  }
  return { clientId: PUBLIC_GRAPH_CLI_CLIENT_ID, tenantId, usesPublicClient: true };
}

/** Development aid: a JSON file with Graph-shaped events used instead of the live calendar. */
export function getCalendarFixturePath(): string | undefined {
  return process.env.ZEFF_CALENDAR_FIXTURE?.trim() || undefined;
}

/** IANA time zone of the server, used to ask Graph for local event times. */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
