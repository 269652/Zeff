"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { disconnectDriveAction, saveDriveClientAction, saveDriveSettingsAction, syncDriveNowAction } from "./server-actions";
import type { ActionState } from "@/app/action-helpers";
import { toast } from "@/components/Toaster";
import { useAction } from "@/components/useAction";
import { formatDayTime } from "@/lib/format";
import { useT } from "@/components/I18nProvider";
import { DriveFolders } from "./DriveFolders";

export type DriveStepView = { key: "drivebackup" | "drivedocs"; name: string; on: boolean; lastAt: string | null; lastOk: boolean | null; lastMessage: string | null };
export type DriveView = {
  clientId: string;
  hasSecret: boolean;
  connected: boolean;
  email: string;
  connectedAt: string | null;
  fullAccess: boolean;
  folderName: string;
  defaultFolder: string;
  mirrorBackupRetention: boolean;
  uploadUnencrypted: boolean;
  pullDocuments: boolean;
  /** Folders of your Drive Zeff reads into the documents. */
  pullFolders: { id: string; path: string }[];
  backupsInDrive: number;
  documentsInDrive: number;
};

const when = (iso: string) => formatDayTime(iso, { year: true });
const link = "text-indigo-600 hover:underline dark:text-indigo-400";

/** The Google Drive page: the few steps to get an OAuth client, signing in, what syncs, and the syncs now. */
export function GoogleDriveSettings({ s, steps, error, justConnected, redirectUri }: { s: DriveView; steps: DriveStepView[]; error: string | null; justConnected: boolean; /** What Google sends you back to (to register with the client). */ redirectUri: string }) {
  const t = useT();
  const { run, pending } = useAction<ActionState>({ done: t("Done."), fallback: t("Didn't work.") });
  const [clientId, setClientId] = useState(s.clientId);
  const [secret, setSecret] = useState("");
  const [folderName, setFolderName] = useState(s.folderName);
  const [mirror, setMirror] = useState(s.mirrorBackupRetention);
  const [unencrypted, setUnencrypted] = useState(s.uploadUnencrypted);
  const [pull, setPull] = useState(s.pullDocuments);
  useEffect(() => {
    if (error) toast(error, { tone: "error" });
    else if (justConnected) toast(t("Connected to Google Drive."), { tone: "ok" });
    // (once, as the page opens)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const needsReconnect = s.connected && (pull || s.pullFolders.length > 0) && !s.fullAccess;

  return (
    <>
      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("1 · Your OAuth client")}</h2>
        <p className="text-sm text-zinc-500">{t("Zeff signs in with a client of your own, so nothing runs through anyone else's account. Once, in Google Cloud Console:")}</p>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
          <li>
            {t("Make a project and switch on the “Google Drive API” in it")}{" "}
            <a className={link} href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noreferrer">
              ↗
            </a>
          </li>
          <li>
            {t("OAuth consent screen: type “External”, add your Google address as a test user — and publish the app (“In production”): while it is in “Testing”, Google ends the sign-in after 7 days")}{" "}
            <a className={link} href="https://console.cloud.google.com/apis/credentials/consent" target="_blank" rel="noreferrer">
              ↗
            </a>
          </li>
          <li>
            {t("Credentials → Create credentials → OAuth client ID → “Web application”, with this authorized redirect URI:")}{" "}
            <a className={link} href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">
              ↗
            </a>
            <code className="mt-1 block rounded bg-zinc-100 px-2 py-1 font-mono text-xs break-all dark:bg-zinc-800">{redirectUri}</code>
          </li>
          <li>{t("Paste its client ID and secret here:")}</li>
        </ol>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="gd-client-id">
              {t("Client ID")}
            </label>
            <input id="gd-client-id" className="input font-mono text-xs" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="123456789-abc….apps.googleusercontent.com" autoComplete="off" />
          </div>
          <div>
            <label className="label" htmlFor="gd-client-secret">
              {t("Client secret")}
            </label>
            <input id="gd-client-secret" type="password" className="input font-mono text-xs" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={s.hasSecret ? t("saved — type a new one to change it") : ""} autoComplete="new-password" />
          </div>
        </div>
        <button className="btn btn-primary" disabled={pending || !clientId.trim()} onClick={() => run(() => saveDriveClientAction({ clientId, clientSecret: secret }), () => setSecret(""))}>
          {t("Save the client")}
        </button>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("2 · Sign in")}</h2>
        {s.connected ? (
          <>
            <p className="text-sm">
              {t("Connected{who}.", { who: s.email ? ` ${t("as {email}", { email: s.email })}` : "" })}{" "}
              <span className="text-zinc-500">
                {s.fullAccess ? t("Zeff can see all of your Drive (to read what you add to its folder).") : t("Zeff can only see the files it puts in Drive itself.")}
                {s.connectedAt ? ` · ${when(s.connectedAt)}` : ""}
              </span>
            </p>
            {needsReconnect && <p className="text-sm text-amber-700 dark:text-amber-400">{t("Reading what you add in Drive needs access to all of it — connect again to give it.")}</p>}
            <div className="flex flex-wrap gap-2">
              <a className="btn" href="/api/google-drive/connect">
                {t("Connect again")}
              </a>
              <button className="btn btn-danger" disabled={pending} onClick={() => run(() => disconnectDriveAction())}>
                {t("Disconnect")}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-zinc-500">{pull || s.pullFolders.length > 0 ? t("Google will ask for access to all of your Drive, because you set Zeff to read what you add there.") : t("Google will ask only for the files Zeff makes itself.")}</p>
            {s.clientId && s.hasSecret ? (
              <a className="btn btn-primary w-fit" href="/api/google-drive/connect">
                {t("Connect Google Drive")}
              </a>
            ) : (
              <p className="text-sm text-zinc-500">{t("Save your client first.")}</p>
            )}
          </>
        )}
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("3 · What syncs")}</h2>
        <div>
          <label className="label" htmlFor="gd-folder">
            {t("Folder in Drive")}
          </label>
          <input id="gd-folder" className="input max-w-xs" value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder={s.defaultFolder} />
          <p className="mt-1 text-xs text-zinc-500">{t("Documents and Backups go into subfolders of it.")}</p>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={pull} onChange={(e) => setPull(e.target.checked)} />
          <span>
            {t("Also bring in what I add to the Documents folder in Drive")}
            <span className="block text-xs text-zinc-500">{t("Off by default. Needs access to all of your Drive (Zeff only looks in its own folder). Deleting a file on one side never deletes it on the other.")}</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
          <span>
            {t("Backups: remove from Drive what the retention removes here")}
            <span className="block text-xs text-zinc-500">{t("Only backups Zeff put there are ever removed.")}</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={unencrypted} onChange={(e) => setUnencrypted(e.target.checked)} />
          <span>
            {t("Backups: also upload those without a password")}
            <span className="block text-xs text-zinc-500">{t("A backup is your whole database — without a password anyone with the file can read it. Off: they stay here.")}</span>
          </span>
        </label>
        <button className="btn btn-primary" disabled={pending} onClick={() => run(() => saveDriveSettingsAction({ folderName, mirrorBackupRetention: mirror, uploadUnencrypted: unencrypted, pullDocuments: pull }))}>
          {t("Save")}
        </button>
      </section>

      <DriveFolders folders={s.pullFolders} connected={s.connected} fullAccess={s.fullAccess} />

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Syncs")}</h2>
        <ul className="space-y-3">
          {steps.map((st) => (
            <li key={st.key} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{st.name}</span>
                <span className="text-xs text-zinc-500">
                  {st.on ? t("on") : t("off")}
                  {st.key === "drivedocs" ? ` · ${t("{n} in Drive", { n: s.documentsInDrive })}` : ` · ${t("{n} in Drive", { n: s.backupsInDrive })}`}
                </span>
                {st.on ? (
                  <button className="btn btn-sm ml-auto" disabled={pending || !s.connected} onClick={() => run(() => syncDriveNowAction(st.key))}>
                    {t("Sync now")}
                  </button>
                ) : (
                  <Link href="/plugins" className={`ml-auto text-xs ${link}`}>
                    {t("Turn on under Plugins")}
                  </Link>
                )}
              </div>
              {st.lastAt && (
                <p className={`text-xs ${st.lastOk === false ? "text-red-600 dark:text-red-400" : "text-zinc-500"}`}>
                  {when(st.lastAt)}
                  {st.lastMessage ? ` — ${st.lastMessage}` : ""}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
