import path from "node:path";
import { accountChrome } from "@/db/accounts";

/** The plugins' browser drivers (MCP servers over stdio, run by Zeff) — Outlook Web serves the mail and the calendar plugin. */
export type DriverId = "chrono" | "punch" | "teams" | "gitlab" | "outlook" | "gmail" | "whatsapp" | "keep" | "google-calendar";

/** Where a plugin's driver is. */
export const driverPath = (id: DriverId) => path.join(/*turbopackIgnore: true*/ process.cwd(), "src", "plugins", id, "driver.mjs");

const ENDPOINTS = ["CHRONO_CDP_ENDPOINT", "TEAMS_CDP_ENDPOINT", "GITLAB_CDP_ENDPOINT", "OUTLOOK_CDP_ENDPOINT", "GMAIL_CDP_ENDPOINT", "WHATSAPP_CDP_ENDPOINT", "KEEP_CDP_ENDPOINT", "GCAL_CDP_ENDPOINT"] as const;

/**
 * The environment a driver runs in: the automation Chrome of the account it runs for (each
 * account its own — its own sign-ins), unless the server was started with an endpoint set.
 */
export function automationEnv(): Record<string, string> {
  const c = accountChrome();
  const env: Record<string, string> = {};
  for (const k of ENDPOINTS) if (!process.env[k]) env[k] = c.endpoint;
  if (c.profile) env.ZEFF_CHROME_PROFILE = c.profile;
  return env;
}

/** The automation Chrome's debug endpoint for one service (its own env setting first), of the account this runs for. */
export const automationCdp = (service: "chrono" | "teams" | "gitlab" | "outlook" | "gmail" | "whatsapp" | "keep" = "chrono") =>
  (service !== "chrono" && process.env[`${service.toUpperCase()}_CDP_ENDPOINT`]) || process.env.CHRONO_CDP_ENDPOINT || accountChrome().endpoint;
