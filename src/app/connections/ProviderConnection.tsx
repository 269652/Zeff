"use client";

import { useEffect, useState } from "react";
import { disconnectProviderAction, saveProviderAction, setDriverAction, testProviderAction } from "./actions";
import type { ActionState } from "@/app/action-helpers";
import { Field } from "@/components/Field";
import { toast } from "@/components/Toaster";
import { useAction } from "@/components/useAction";
import { useT } from "@/components/I18nProvider";

export type ProviderView = {
  provider: "google" | "microsoft";
  label: string;
  clientId: string;
  hasSecret: boolean;
  tenant: string;
  connected: boolean;
  account: string;
  redirectUri: string;
  /** Its services, with how each is reached now and whether its plugin is installed. */
  services: { service: string; label: string; driver: "cdp" | "api"; installed: boolean }[];
};

const link = "text-indigo-600 hover:underline dark:text-indigo-400";

/** One provider's card: which way each of its services is reached, and — for the API — your OAuth client and the sign-in. */
export function ProviderConnection({ v, error, justConnected }: { v: ProviderView; error: string | null; justConnected: boolean }) {
  const t = useT();
  const { run, pending } = useAction<ActionState>({ done: t("Done."), fallback: t("Didn't work.") });
  const [clientId, setClientId] = useState(v.clientId);
  const [secret, setSecret] = useState("");
  const [tenant, setTenant] = useState(v.tenant);
  const google = v.provider === "google";
  const anyApi = v.services.some((s) => s.driver === "api");
  useEffect(() => {
    if (error) toast(error, { tone: "error" });
    else if (justConnected) toast(t("Connected to {provider}.", { provider: v.label }), { tone: "ok" });
    // (once, as the page opens)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const clientSaved = clientId === v.clientId && !secret && (google || tenant === v.tenant);

  return (
    <section className="card space-y-3 p-4">
      <h2 className="text-sm font-semibold text-zinc-500 uppercase">{v.label}</h2>
      <ul className="space-y-2">
        {v.services.map((s) => (
          <li key={s.service} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="w-40 font-medium">
              {s.label}
              {!s.installed && <span className="ml-1 text-xs font-normal text-zinc-400">{t("not installed")}</span>}
            </span>
            <label className="flex items-center gap-1.5">
              <input type="radio" name={`drv-${s.service}`} checked={s.driver === "cdp"} disabled={pending} onChange={() => run(() => setDriverAction(s.service, "cdp"))} />
              {t("Automation Chrome (CDP)")}
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name={`drv-${s.service}`} checked={s.driver === "api"} disabled={pending} onChange={() => run(() => setDriverAction(s.service, "api"))} />
              {t("{provider}'s API", { provider: v.label })}
            </label>
          </li>
        ))}
      </ul>

      {anyApi && (
        <div className="space-y-3 border-l-2 border-zinc-200 pl-3 dark:border-zinc-700">
          {google ? (
            <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
              <li>
                {t("In Google Cloud Console make a project and switch on the “Gmail API” and the “Google Calendar API”")}{" "}
                <a className={link} href="https://console.cloud.google.com/apis/library" target="_blank" rel="noreferrer">
                  ↗
                </a>
              </li>
              <li>{t("OAuth consent screen: add your address as a test user and publish the app (in “Testing” Google ends the sign-in after 7 days). Zeff only asks to read.")}</li>
              <li>
                {t("Credentials → OAuth client ID → “Web application”, with this authorized redirect URI:")}
                <code className="mt-1 block rounded bg-zinc-100 px-2 py-1 font-mono text-xs break-all dark:bg-zinc-800">{v.redirectUri}</code>
              </li>
            </ol>
          ) : (
            <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
              <li>
                {t("In the Microsoft Entra admin center: App registrations → New registration (accounts in this organizational directory)")}{" "}
                <a className={link} href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noreferrer">
                  ↗
                </a>
              </li>
              <li>
                {t("Authentication → add the platform “Mobile and desktop applications” with this redirect URI, and allow public client flows:")}
                <code className="mt-1 block rounded bg-zinc-100 px-2 py-1 font-mono text-xs break-all dark:bg-zinc-800">{v.redirectUri}</code>
              </li>
              <li>{t("API permissions → Microsoft Graph, delegated: Mail.Read, Calendars.Read, Chat.Read, User.Read, offline_access. If your organization requires it, an administrator has to grant consent.")}</li>
            </ol>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={google ? t("Client ID") : t("Application (client) ID")} required>
              {(p) => <input {...p} className="input font-mono text-xs" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />}
            </Field>
            {google ? (
              <Field label={t("Client secret")} required={!v.hasSecret}>
                {(p) => <input {...p} type="password" className="input font-mono text-xs" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={v.hasSecret ? t("saved — type a new one to change it") : ""} autoComplete="new-password" />}
              </Field>
            ) : (
              <Field label={t("Directory (tenant) ID or domain")}>
                {(p) => <input {...p} className="input font-mono text-xs" value={tenant} onChange={(e) => setTenant(e.target.value)} placeholder="organizations" autoComplete="off" />}
              </Field>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-primary" disabled={pending || !clientId.trim() || clientSaved} onClick={() => run(() => saveProviderAction({ provider: v.provider, clientId, clientSecret: secret, tenant }), () => setSecret(""))}>
              {t("Save the client")}
            </button>
            {clientSaved && v.clientId && !v.connected && (
              <a className="btn" href={`/api/connectors/${v.provider}/connect`}>
                {t("Sign in to {provider}", { provider: v.label })}
              </a>
            )}
            {clientSaved && v.connected && (
              <>
                <button className="btn" disabled={pending} onClick={() => run(() => testProviderAction(v.provider))}>
                  {t("Test")}
                </button>
                <a className="btn" href={`/api/connectors/${v.provider}/connect`}>
                  {t("Connect again")}
                </a>
                <button className="btn btn-danger" disabled={pending} onClick={() => run(() => disconnectProviderAction(v.provider))}>
                  {t("Disconnect")}
                </button>
                <span className="text-xs text-zinc-500">{v.account ? t("Signed in as {account}", { account: v.account }) : t("Signed in")}</span>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
