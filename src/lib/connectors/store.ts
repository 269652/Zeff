/**
 * Which way Zeff talks to a service: through the automation Chrome ("cdp") or through the
 * service's own API ("api", with a token or an OAuth sign-in) — and the sign-in for the API.
 * The driver is chosen per service (Gmail, Google Calendar, Outlook Mail …), the sign-in is the
 * provider's (one Google sign-in serves Gmail and Google Calendar, one Microsoft sign-in serves
 * Outlook and Teams). One row each. Server only.
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { ConnectorRow } from "@/db/schema";

const { connectors } = schema;

/** Whose API it is — and whose sign-in. */
export type Provider = "gitlab" | "google" | "microsoft";
/** The services that can use their API (the others only have the Chrome). */
export const API_SERVICES = ["gitlab", "gmail", "gcalendar", "outlook-mail", "outlook-calendar", "teams"] as const;
export type ApiService = (typeof API_SERVICES)[number];
export const PROVIDER_OF: Record<ApiService, Provider> = { gitlab: "gitlab", gmail: "google", gcalendar: "google", "outlook-mail": "microsoft", "outlook-calendar": "microsoft", teams: "microsoft" };
/** "com": Outlook on this PC read through its own COM interface (classic Outlook, Windows) — only the Outlook calendar offers it. */
export type DriverMode = "cdp" | "api" | "com";
/** The services that can be read from the Outlook installed on this PC (COM). */
export const COM_SERVICES: readonly ApiService[] = ["outlook-calendar"];
export const comAvailable = (service: ApiService): boolean => process.platform === "win32" && COM_SERVICES.includes(service);
export type AuthKind = "token" | "oauth";

type Key = ApiService | Provider;

/** The row (made when first asked for): a service's (its driver) or a provider's (its sign-in). */
export function getConnector(key: Key): ConnectorRow {
  const db = getDb();
  const row = db.select().from(connectors).where(eq(connectors.service, key)).get();
  if (row) return row;
  db.insert(connectors).values({ service: key }).onConflictDoNothing().run();
  return db.select().from(connectors).where(eq(connectors.service, key)).get()!;
}

export function updateConnector(key: Key, patch: Partial<Omit<ConnectorRow, "service">>): ConnectorRow {
  getConnector(key);
  return getDb().update(connectors).set(patch).where(eq(connectors.service, key)).returning().get();
}

/**
 * The OAuth client of a provider: the one saved on the Connections page, else the one in the
 * environment (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, MICROSOFT_… likewise).
 */
export function clientOf(provider: Provider): { clientId: string; clientSecret: string; fromEnv: boolean } {
  const row = getConnector(provider);
  const prefix = provider.toUpperCase();
  const envId = process.env[`${prefix}_CLIENT_ID`]?.trim() ?? "";
  if (row.clientId || !envId) return { clientId: row.clientId, clientSecret: row.clientSecret, fromEnv: false };
  return { clientId: envId, clientSecret: process.env[`${prefix}_CLIENT_SECRET`]?.trim() ?? "", fromEnv: true };
}

/** How the service is reached now. */
export const driverOf = (service: ApiService): DriverMode => {
  const d = getConnector(service).driver;
  return d === "api" ? "api" : d === "com" && comAvailable(service) ? "com" : "cdp";
};

/** Signed in for the API: a token, or an OAuth refresh token. */
export const apiConnected = (r: ConnectorRow): boolean => (r.authKind === "oauth" ? !!r.refreshToken : !!r.token);

/** The provider's extra settings (Microsoft: { tenant }). */
export function extraOf(provider: Provider): Record<string, string> {
  try {
    const v = JSON.parse(getConnector(provider).extra) as unknown;
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** The sign-in forgotten (token, OAuth tokens); the choice of driver and the OAuth client stay. */
export function disconnectConnector(provider: Provider): void {
  updateConnector(provider, { token: "", accessToken: "", refreshToken: "", expiresAt: 0, scope: "", account: "", connectedAt: null });
}
