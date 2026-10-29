"use client";

import { useEffect, useState, type ReactNode } from "react";
import { disconnectProviderAction, saveProviderAction, setCalendarWriteAction, setDriverAction, setGmailWriteAction, testProviderAction } from "./actions";
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
  /** Google: writing to Gmail (sending, drafts, labels, read, archive, spam, filters) is asked for at sign-in. */
  gmailWrite: boolean;
  /** Google: writing to Google Calendar (events made, moved, answered) is asked for at sign-in. */
  calendarWrite: boolean;
  /** What the sign-in holds now (Google). */
  granted: { gmailRead: boolean; gmailModify: boolean; gmailFilters: boolean; calendar: boolean; calendarWrite: boolean };
  connected: boolean;
  account: string;
  redirectUri: string;
  /** Its services, with how each is reached now and whether its plugin is installed. */
  services: { service: string; label: string; driver: "cdp" | "api"; installed: boolean }[];
};

// Links in the steps' text: underlined (not told apart by colour alone).
const link = "text-indigo-600 underline underline-offset-2 dark:text-indigo-400";

function Pill({ tone, children }: { tone: "ok" | "warn" | "idle"; children: ReactNode }) {
  const c = tone === "ok" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : tone === "warn" ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c}`}>{children}</span>;
}

/** A step of the set-up: a number (a tick once done), its title, its body. */
function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${done ? "bg-emerald-600 text-white" : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-100"}`} aria-hidden>
        {done ? "✓" : n}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {children}
      </div>
    </li>
  );
}

/** One provider's card: how each service is reached, then — for the API — three steps: make the sign-in app, tell Zeff its client, sign in. */
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
  const hasClient = clientSaved && !!v.clientId && (!google || v.hasSecret);
  const needsReSignIn = google && v.connected && v.gmailWrite && !(v.granted.gmailModify && v.granted.gmailFilters);
  const calendarNeedsReSignIn = google && v.connected && v.calendarWrite && !v.granted.calendarWrite;
  const copy = async () => {
    await navigator.clipboard?.writeText(v.redirectUri).catch(() => undefined);
    toast(t("Copied."), { tone: "ok" });
  };
  const uri = (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 rounded bg-zinc-100 px-2 py-1 font-mono text-xs break-all dark:bg-zinc-800">{v.redirectUri}</code>
      <button type="button" className="btn btn-sm" onClick={() => void copy()}>
        {t("Copy")}
      </button>
    </div>
  );

  return (
    <section className="card space-y-4 p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">{v.label}</h2>
        {!anyApi ? <Pill tone="idle">{t("Automation Chrome")}</Pill> : v.connected ? <Pill tone="ok">{v.account ? t("Signed in as {account}", { account: v.account }) : t("Signed in")}</Pill> : <Pill tone="warn">{t("API chosen — not signed in yet")}</Pill>}
      </header>

      <div>
        <h3 className="mb-1 text-xs font-semibold text-zinc-500 uppercase">{t("How each service is read")}</h3>
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {v.services.map((s) => (
            <li key={s.service} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="font-medium">
                {s.label}
                {!s.installed && <span className="ml-1 text-xs font-normal text-zinc-400">{t("not installed")}</span>}
              </span>
              <span className="inline-flex overflow-hidden rounded-md border border-zinc-300 text-xs dark:border-zinc-700" role="group" aria-label={s.label}>
                {(["cdp", "api"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    disabled={pending}
                    aria-pressed={s.driver === d}
                    className={`px-3 py-1.5 ${s.driver === d ? "bg-zinc-900 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                    onClick={() => s.driver !== d && run(() => setDriverAction(s.service, d))}
                  >
                    {d === "cdp" ? t("Automation Chrome") : t("{provider}'s API", { provider: v.label })}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
        {!anyApi && <p className="mt-1 text-xs text-zinc-500">{t("Choose the API for a service to set up its sign-in here.")}</p>}
      </div>

      {anyApi && (
        <ol className="space-y-5 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <Step n={1} done={hasClient} title={google ? t("Make a sign-in app at Google (once)") : t("Register the app at Microsoft (once)")}>
            <details open={!v.clientId} className="text-sm text-zinc-600 dark:text-zinc-300">
              <summary className="cursor-pointer text-xs text-zinc-500">{t("Show how")}</summary>
              {google ? (
                <ol className="mt-2 list-decimal space-y-1.5 pl-5">
                  <li>
                    {t("In Google Cloud Console make a project and switch on the “Gmail API” and the “Google Calendar API”")}{" "}
                    <a className={link} href="https://console.cloud.google.com/apis/library" target="_blank" rel="noreferrer">
                      ↗
                    </a>
                  </li>
                  <li>{t("OAuth consent screen: add your address as a test user and publish the app (in “Testing” Google ends the sign-in after 7 days).")}</li>
                  <li>
                    {t("Credentials → OAuth client ID → “Web application”, with this authorized redirect URI:")}
                    <div className="mt-1">{uri}</div>
                  </li>
                </ol>
              ) : (
                <ol className="mt-2 list-decimal space-y-1.5 pl-5">
                  <li>
                    {t("In the Microsoft Entra admin center: App registrations → New registration (accounts in this organizational directory)")}{" "}
                    <a className={link} href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noreferrer">
                      ↗
                    </a>
                  </li>
                  <li>
                    {t("Authentication → add the platform “Mobile and desktop applications” with this redirect URI, and allow public client flows:")}
                    <div className="mt-1">{uri}</div>
                  </li>
                  <li>{t("API permissions → Microsoft Graph, delegated: Mail.Read, Calendars.Read, Chat.Read, User.Read, offline_access. If your organization requires it, an administrator has to grant consent.")}</li>
                </ol>
              )}
            </details>
          </Step>

          <Step n={2} done={hasClient} title={t("Tell Zeff the app's client")}>
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
            <button className="btn btn-primary btn-sm" disabled={pending || !clientId.trim() || clientSaved} onClick={() => run(() => saveProviderAction({ provider: v.provider, clientId, clientSecret: secret, tenant }), () => setSecret(""))}>
              {t("Save the client")}
            </button>
          </Step>

          <Step n={3} done={v.connected} title={t("Sign in")}>
            {!hasClient ? (
              <p className="text-xs text-zinc-500">{t("Save the client first.")}</p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {!v.connected ? (
                  <a className="btn btn-primary btn-sm" href={`/api/connectors/${v.provider}/connect`}>
                    {t("Sign in to {provider}", { provider: v.label })}
                  </a>
                ) : (
                  <>
                    <button className="btn btn-sm" disabled={pending} onClick={() => run(() => testProviderAction(v.provider))}>
                      {t("Test")}
                    </button>
                    <a className="btn btn-sm" href={`/api/connectors/${v.provider}/connect`}>
                      {t("Connect again")}
                    </a>
                    <button className="btn btn-danger btn-sm" disabled={pending} onClick={() => run(() => disconnectProviderAction(v.provider))}>
                      {t("Disconnect")}
                    </button>
                  </>
                )}
              </div>
            )}
          </Step>

          {google && (
            <li className="space-y-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900/50">
              <h3 className="text-sm font-medium">{t("What Zeff may do with Google")}</h3>
              <div className="flex flex-wrap gap-1.5">
                <Pill tone={v.connected && v.granted.gmailRead ? "ok" : "idle"}>{v.connected && v.granted.gmailRead ? "✓" : "–"} {t("Read Gmail")}</Pill>
                <Pill tone={v.connected && v.granted.calendar ? "ok" : "idle"}>{v.connected && v.granted.calendar ? "✓" : "–"} {t("Read the calendar")}</Pill>
                <Pill tone={v.connected && v.granted.gmailModify ? "ok" : "idle"}>{v.connected && v.granted.gmailModify ? "✓" : "–"} {t("Send and change Gmail (drafts, labels, read, archive, spam)")}</Pill>
                <Pill tone={v.connected && v.granted.gmailFilters ? "ok" : "idle"}>{v.connected && v.granted.gmailFilters ? "✓" : "–"} {t("Make Gmail filters")}</Pill>
                <Pill tone={v.connected && v.granted.calendarWrite ? "ok" : "idle"}>{v.connected && v.granted.calendarWrite ? "✓" : "–"} {t("Write to Google Calendar (events, answers)")}</Pill>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={v.gmailWrite} disabled={pending} onChange={(e) => run(() => setGmailWriteAction(e.target.checked))} />
                <span>
                  {t("Allow writing to Gmail")}
                  <span className="block text-xs text-zinc-500">
                    {t("Sending and drafts on your click (a todo's mail, a reply in the inbox), archive and unread; labels, read, spam and filters also for agents whose permissions say so. Agents never send — they propose, you click. Nothing is ever deleted or forwarded.")}
                  </span>
                </span>
              </label>
              {needsReSignIn && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {t("Google doesn't hold this right yet — sign in again to grant it.")}{" "}
                  <a className={link} href="/api/connectors/google/connect">
                    {t("Connect again")}
                  </a>
                </p>
              )}
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={v.calendarWrite} disabled={pending} onChange={(e) => run(() => setCalendarWriteAction(e.target.checked))} />
                <span>
                  {t("Allow writing to Google Calendar")}
                  <span className="block text-xs text-zinc-500">
                    {t("On your click only: events made, moved or edited in calendars you own or may write, invitations answered, a todo's appointment entered. Agents only propose. Nothing is ever deleted or cancelled.")}
                  </span>
                </span>
              </label>
              {calendarNeedsReSignIn && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {t("Google doesn't hold this right yet — sign in again to grant it.")}{" "}
                  <a className={link} href="/api/connectors/google/connect">
                    {t("Connect again")}
                  </a>
                </p>
              )}
            </li>
          )}
        </ol>
      )}
    </section>
  );
}
