/**
 * The providers Zeff can sign in to for an API driver: where the OAuth sign-in goes, what it asks
 * for, which services use it, and where you land afterwards. Server only (reads settings).
 */
import { gitlabEndpoints } from "@/lib/gitlab/api";
import type { OAuthEndpoints } from "./oauth";
import { extraOf, type ApiService, type Provider } from "./store";

export type ProviderInfo = {
  id: Provider;
  label: string;
  /** Where the sign-in leads back to. */
  page: string;
  /** The sign-in's addresses (the tests' stand-ins can be set in the environment). */
  endpoints: () => OAuthEndpoints;
  /** The services that use this provider's API, with their plugin ids. */
  services: { service: ApiService; label: string; plugin: string }[];
};

/** Google: read access to Gmail and Calendar (nothing is written to either). */
const GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/calendar.readonly"];
/** Changing Gmail (labels, read, spam — no deleting): asked for only when you allow it on the Connections page. */
export const gmailWriteAllowed = () => extraOf("google").gmailWrite === "1";
/** Microsoft: read access to the mail, the calendar and your chats (channels need an administrator's consent: not asked for). */
const MICROSOFT_SCOPES = ["offline_access", "User.Read", "Mail.Read", "Calendars.Read", "Chat.Read"];

export const microsoftTenant = () => extraOf("microsoft").tenant?.trim() || "organizations";
const microsoftLogin = () => process.env.ZEFF_MS_LOGIN_URL || "https://login.microsoftonline.com";

export const PROVIDERS: Record<Provider, ProviderInfo> = {
  gitlab: { id: "gitlab", label: "GitLab", page: "/settings/gitlab", endpoints: gitlabEndpoints, services: [{ service: "gitlab", label: "GitLab", plugin: "gitlab" }] },
  google: {
    id: "google",
    label: "Google",
    page: "/settings/connections",
    endpoints: () => ({
      authUrl: process.env.ZEFF_GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: process.env.ZEFF_GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token",
      scope: [...GOOGLE_SCOPES, ...(gmailWriteAllowed() ? ["https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/gmail.settings.basic"] : [])].join(" "),
      // A refresh token every time (else only the first sign-in gets one), and the account chooser.
      extra: { access_type: "offline", prompt: "consent select_account" },
    }),
    services: [
      { service: "gmail", label: "Gmail", plugin: "gmail" },
      { service: "gcalendar", label: "Google Calendar", plugin: "google-calendar" },
    ],
  },
  microsoft: {
    id: "microsoft",
    label: "Microsoft",
    page: "/settings/connections",
    endpoints: () => ({
      authUrl: `${microsoftLogin()}/${microsoftTenant()}/oauth2/v2.0/authorize`,
      tokenUrl: `${microsoftLogin()}/${microsoftTenant()}/oauth2/v2.0/token`,
      scope: MICROSOFT_SCOPES.join(" "),
      extra: { prompt: "select_account" },
    }),
    services: [
      { service: "outlook-mail", label: "Outlook Mail", plugin: "outlook-mail" },
      { service: "outlook-calendar", label: "Outlook Calendar", plugin: "outlook-calendar" },
      { service: "teams", label: "Microsoft Teams", plugin: "teams" },
    ],
  },
};

export const isProvider = (v: string): v is Provider => v === "gitlab" || v === "google" || v === "microsoft";
