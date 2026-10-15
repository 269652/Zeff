"use client";

import { useEffect, useState } from "react";
import { disconnectGitlabAction, saveGitlabConnectionAction, testGitlabApiAction } from "./server-actions";
import type { ActionState } from "@/app/action-helpers";
import { toast } from "@/components/Toaster";
import { useAction } from "@/components/useAction";
import { useT } from "@/components/I18nProvider";

export type GitlabConnectionView = {
  driver: "cdp" | "api";
  authKind: "token" | "oauth";
  hasToken: boolean;
  clientId: string;
  hasSecret: boolean;
  connected: boolean;
  account: string;
  host: string;
};

/** How Zeff reaches GitLab: the automation Chrome (what you're signed in with there) or GitLab's API (a token, or an OAuth application of your own). */
export function GitlabConnection({ s, error, justConnected, redirectUri }: { s: GitlabConnectionView; error: string | null; justConnected: boolean; /** What GitLab sends you back to (to register with the application). */ redirectUri: string }) {
  const t = useT();
  const { run, pending } = useAction<ActionState>({ done: t("Done."), fallback: t("Didn't work.") });
  const [driver, setDriver] = useState(s.driver);
  const [authKind, setAuthKind] = useState(s.authKind);
  const [token, setToken] = useState("");
  const [clientId, setClientId] = useState(s.clientId);
  const [secret, setSecret] = useState("");
  useEffect(() => {
    if (error) toast(error, { tone: "error" });
    else if (justConnected) toast(t("Connected to GitLab."), { tone: "ok" });
    // (once, as the page opens)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = () => run(() => saveGitlabConnectionAction({ driver, authKind, token, clientId, clientSecret: secret }), () => (setToken(""), setSecret("")));
  const saved = driver === s.driver && authKind === s.authKind && !token && !secret && (authKind !== "oauth" || clientId === s.clientId);

  return (
    <section className="card space-y-3 p-4">
      <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Connection")}</h2>
      <fieldset className="space-y-2">
        <legend className="sr-only">{t("Driver")}</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="gl-driver" className="mt-1" checked={driver === "cdp"} onChange={() => setDriver("cdp")} />
          <span>
            {t("Automation Chrome (CDP)")}
            <span className="block text-xs text-zinc-500">{t("Reads through a GitLab tab you are signed in to there — nothing to set up, but Chrome has to run.")}</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="gl-driver" className="mt-1" checked={driver === "api"} onChange={() => setDriver("api")} />
          <span>
            {t("GitLab's API")}
            <span className="block text-xs text-zinc-500">{t("Talks to {host} directly with a token or an OAuth sign-in: no Chrome needed, and it syncs in the background at any time.", { host: s.host })}</span>
          </span>
        </label>
      </fieldset>

      {driver === "api" && (
        <div className="space-y-3 border-l-2 border-zinc-200 pl-3 dark:border-zinc-700">
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="gl-auth" checked={authKind === "token"} onChange={() => setAuthKind("token")} />
              {t("Access token")}
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="gl-auth" checked={authKind === "oauth"} onChange={() => setAuthKind("oauth")} />
              {t("OAuth")}
            </label>
          </div>
          {authKind === "token" ? (
            <div>
              <label className="label" htmlFor="gl-token">
                {t("Personal access token")}
              </label>
              <input id="gl-token" type="password" className="input max-w-md font-mono text-xs" value={token} onChange={(e) => setToken(e.target.value)} placeholder={s.hasToken ? t("saved — type a new one to change it") : "glpat-…"} autoComplete="new-password" />
              <p className="mt-1 text-xs text-zinc-500">{t("On {host} under Preferences → Access tokens, with the scope “api” (the “read_api” scope reads only: no replies, merges or merge requests).", { host: s.host })}</p>
            </div>
          ) : (
            <>
              <p className="text-sm text-zinc-500">{t("On {host} under Preferences → Applications, add an application with this redirect URI, the scopes “api” and “read_user”, and “Confidential” switched off (Zeff signs in with PKCE):", { host: s.host })}</p>
              <code className="block rounded bg-zinc-100 px-2 py-1 font-mono text-xs break-all dark:bg-zinc-800">{redirectUri}</code>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="gl-client-id">
                    {t("Application ID")}
                  </label>
                  <input id="gl-client-id" className="input font-mono text-xs" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
                </div>
                <div>
                  <label className="label" htmlFor="gl-client-secret">
                    {t("Secret (only for a confidential application)")}
                  </label>
                  <input id="gl-client-secret" type="password" className="input font-mono text-xs" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={s.hasSecret ? t("saved — type a new one to change it") : ""} autoComplete="new-password" />
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary" disabled={pending || saved} onClick={save}>
          {t("Save")}
        </button>
        {driver === "api" && s.driver === "api" && saved && authKind === "oauth" && !s.connected && (
          <a className="btn" href="/api/connectors/gitlab/connect">
            {t("Sign in to GitLab")}
          </a>
        )}
        {driver === "api" && s.driver === "api" && saved && s.connected && (
          <>
            <button className="btn" disabled={pending} onClick={() => run(() => testGitlabApiAction())}>
              {t("Test")}
            </button>
            {authKind === "oauth" && (
              <a className="btn" href="/api/connectors/gitlab/connect">
                {t("Connect again")}
              </a>
            )}
            <button className="btn btn-danger" disabled={pending} onClick={() => run(() => disconnectGitlabAction())}>
              {t("Disconnect")}
            </button>
          </>
        )}
        {s.driver === "api" && saved && s.connected && <span className="text-xs text-zinc-500">{s.account ? t("Signed in as @{account}", { account: s.account }) : t("Signed in")}</span>}
        {s.driver === "api" && saved && !s.connected && <span className="text-xs text-amber-700 dark:text-amber-400">{authKind === "token" ? t("Add a token and save.") : t("Save the application, then sign in.")}</span>}
      </div>
    </section>
  );
}
