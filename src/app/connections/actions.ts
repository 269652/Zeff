"use server";

import { revalidateAll, type ActionState } from "@/app/action-helpers";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";

/** The Connections page's server actions (each answers an ActionState). */

/** Which way a service is reached: through the automation Chrome or through its API. */
export async function setDriverAction(service: string, driver: string): Promise<ActionState> {
  try {
    const { API_SERVICES, updateConnector } = await import("@/lib/connectors/store");
    if (!(API_SERVICES as readonly string[]).includes(service)) return { ok: false, error: t("Unknown service.") };
    updateConnector(service as (typeof API_SERVICES)[number], { driver: driver === "api" ? "api" : "cdp" });
    revalidateAll();
    return { ok: true, message: driver === "api" ? t("Read through its API now.") : t("Read through the automation Chrome now.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Your OAuth client of a provider (Google, Microsoft) — a secret only when one is typed (else the saved one stays). A new client signs you out. */
export async function saveProviderAction(v: { provider: string; clientId: string; clientSecret?: string; tenant?: string; gmailWrite?: boolean }): Promise<ActionState> {
  try {
    const { isProvider } = await import("@/lib/connectors/providers");
    const { clientOf, getConnector, updateConnector, disconnectConnector } = await import("@/lib/connectors/store");
    if (!isProvider(v.provider) || v.provider === "gitlab") return { ok: false, error: t("Unknown provider.") };
    const clientId = String(v.clientId ?? "").trim();
    const secret = String(v.clientSecret ?? "").trim();
    const tenant = String(v.tenant ?? "").trim();
    if (!clientId) return { ok: false, error: t("The client ID is missing.") };
    if (v.provider === "google" && !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) return { ok: false, error: t("The client ID looks like 123456-abc….apps.googleusercontent.com.") };
    if (v.provider === "google" && !secret && !clientOf("google").clientSecret) return { ok: false, error: t("The client secret is missing.") };
    if (v.provider === "microsoft" && tenant && !/^[\w.-]+$/.test(tenant)) return { ok: false, error: t("The tenant is a directory ID, a domain, or “organizations”.") };
    const row = getConnector(v.provider);
    let extra = row.extra;
    if (v.provider === "microsoft") extra = JSON.stringify({ tenant });
    if (v.provider === "google") extra = JSON.stringify({ gmailWrite: v.gmailWrite ? "1" : "0" });
    const changed = clientId !== row.clientId || (secret !== "" && secret !== row.clientSecret) || extra !== row.extra;
    if (changed && row.refreshToken) disconnectConnector(v.provider);
    updateConnector(v.provider, { authKind: "oauth", clientId, extra, ...(secret ? { clientSecret: secret } : {}) });
    revalidateAll();
    return { ok: true, message: changed && row.refreshToken ? t("Saved. The new client needs you to connect again.") : t("Saved.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A provider's sign-in forgotten (the OAuth tokens). */
export async function disconnectProviderAction(provider: string): Promise<ActionState> {
  try {
    const { isProvider } = await import("@/lib/connectors/providers");
    if (!isProvider(provider)) return { ok: false, error: t("Unknown provider.") };
    (await import("@/lib/connectors/store")).disconnectConnector(provider);
    revalidateAll();
    return { ok: true, message: t("Disconnected.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A read of the signed-in user: tests the sign-in and shows who it is. */
export async function testProviderAction(provider: string): Promise<ActionState> {
  try {
    const { isProvider, PROVIDERS } = await import("@/lib/connectors/providers");
    if (!isProvider(provider)) return { ok: false, error: t("Unknown provider.") };
    const who = await (await import("@/lib/connectors/who")).whoAmI(provider);
    (await import("@/lib/connectors/store")).updateConnector(provider, { account: who });
    revalidateAll();
    return { ok: true, message: t("Signed in to {provider} as {who}.", { provider: PROVIDERS[provider].label, who }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
