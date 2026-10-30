import { isInstalled } from "@/plugins/state";
import { extensionInstalled } from "@/plugins/extension-state";
import { isConnected as isDriveConnected } from "@/plugins/google-drive/config";
import type { Metadata } from "next";
import { availableLanguages, t } from "@/lib/i18n/server";
import { rich } from "@/lib/i18n/rich";
import Link from "next/link";
import { connection } from "next/server";
import { HashRedirect } from "@/components/HashRedirect";
import { BackupSettings } from "@/plugins/backup/BackupSettings";
import { ParallelDefaultSetting } from "@/components/ParallelControls";
import { defaultParallelMode } from "@/lib/entry-parallel";
import { getBackupSettings, listBackups } from "@/plugins/backup/backup";
import { LanguagePicker } from "@/components/LanguagePicker";
import { TouchSettings } from "@/components/TouchSettings";
import { LockSettings } from "@/components/LockSettings";
import { lockEnabled } from "@/lib/lock/shared";
import { guardedActions, listCredentials } from "@/lib/touch";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("General settings") };
}

/** Backups → Google Drive: on (the extension), signed in. */
function driveBackupView() {
  return { on: extensionInstalled("google-drive:backup-sync"), connected: isDriveConnected(), installed: isInstalled("google-drive") };
}

/** Settings → General: language, parallel work, touch to approve, lock, backups (the AI, connections and the briefing have pages of their own). */
export default async function PreferencesPage() {
  await connection();
  return (
    <div className="page">
      <div className="page-aside">
        <Link href="/settings" className="text-sm text-zinc-500 hover:underline">
          ← {t("Settings")}
        </Link>
        <h1 className="text-lg font-semibold">{t("General")}</h1>
        <p className="text-sm text-zinc-500">
          {rich(t("The AI is set on the <ai>AI</ai> page, the services on <connections>Connections</connections>, the briefing under <todos>Todo settings</todos> — all of them in <settings>Settings</settings>."), {
            ai: (s) => (
              <Link href="/settings/ai" className="text-indigo-600 hover:underline dark:text-indigo-400">
                {s}
              </Link>
            ),
            connections: (s) => (
              <Link href="/settings/connections" className="text-indigo-600 hover:underline dark:text-indigo-400">
                {s}
              </Link>
            ),
            todos: (s) => (
              <Link href="/settings/todos#boards" className="text-indigo-600 hover:underline dark:text-indigo-400">
                {s}
              </Link>
            ),
            settings: (s) => (
              <Link href="/settings" className="text-indigo-600 hover:underline dark:text-indigo-400">
                {s}
              </Link>
            ),
          })}
        </p>
        {/* The briefing's settings moved to Todo settings. */}
        <HashRedirect moves={{ boards: "/settings/todos#boards" }} />
      </div>
      <section id="language" className="card scroll-mt-4 space-y-2 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Language")}</h2>
        <p className="text-sm text-zinc-500">
          {rich(t("The language Zeff speaks in this account — from the installed language bundles (<link>Plugins</link>). Dates and numbers follow it."), {
            link: (s) => (
              <Link href="/plugins" className="text-indigo-600 hover:underline dark:text-indigo-400">
                {s}
              </Link>
            ),
          })}
        </p>
        <LanguagePicker available={availableLanguages()} />
      </section>
      {isInstalled("zeiterfassung") && (
        <section id="parallel" className="card scroll-mt-4 space-y-3 p-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Parallel work")}</h2>
            <p className="max-w-[75ch] text-sm text-zinc-500">
              {t("Two tasks of one job done at the same time (by their start and hours) are not booked on top of each other. Choose how they are booked when Zeff notices — you can change each case afterwards.")}
            </p>
          </div>
          <ParallelDefaultSetting mode={defaultParallelMode()} />
        </section>
      )}
      <section id="touch" className="card scroll-mt-4 space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Touch to approve")}</h2>
          <p className="max-w-[75ch] text-sm text-zinc-500">
            {t(
              "A security key (a YubiKey) approves actions that reach outside Zeff: when switched on, the real fill into Chrono or Punch waits for a touch — from the page only, never from an agent. Register a second key as a spare; if you lose all of them, delete the touch.* settings in the database.",
            )}
          </p>
        </div>
        <TouchSettings
          keys={listCredentials().map((k) => ({ id: k.id, label: k.label, rpId: k.rpId, createdAt: k.createdAt }))}
          exportGuarded={guardedActions().includes("booking-export")}
        />
      </section>
      <section id="lock" className="card scroll-mt-4 space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Lock")}</h2>
          <p className="max-w-[75ch] text-sm text-zinc-500">
            {t(
              "Zeff opens only with the PIN of your security key and a touch, and locks the moment you pull the key out. The PIN is the key's own (set it with the Yubico software or Windows: Settings → Accounts → Sign-in options → Security key). Only the browser is locked — agents and scripts on this computer are not. Locked out? Delete data/lock.json next to the database.",
            )}
          </p>
        </div>
        <LockSettings enabled={lockEnabled()} hasKeys={listCredentials().length > 0} />
      </section>
      {isInstalled("backup") && (
        <section id="backups" className="card scroll-mt-4 space-y-3 p-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Backups")}</h2>
            <p className="max-w-[75ch] text-sm text-zinc-500">
              {t(
                "Zeff's data — the database and the files beside it (calendar inbox, run logs) — as a ZIP, AES-256 encrypted with a password. Runs by itself; here also by hand at any time, and restore here.",
              )}
            </p>
          </div>
          <BackupSettings s={getBackupSettings()} backups={listBackups()} drive={driveBackupView()} />
        </section>
      )}
    </div>
  );
}
