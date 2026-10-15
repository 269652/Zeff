import { isInstalled } from "@/plugins/state";
import { extensionInstalled } from "@/plugins/extension-state";
import { isConnected as isDriveConnected } from "@/plugins/google-drive/config";
import type { Metadata } from "next";
import { availableLanguages, t } from "@/lib/i18n/server";
import { rich } from "@/lib/i18n/rich";
import Link from "next/link";
import { connection } from "next/server";
import { BoardSettingsForm } from "@/components/boards/BoardSettingsForm";
import { BackupSettings } from "@/plugins/backup/BackupSettings";
import { ParallelDefaultSetting } from "@/components/ParallelControls";
import { defaultParallelMode } from "@/lib/entry-parallel";
import { getBackupSettings, listBackups } from "@/plugins/backup/backup";
import { aiChoice } from "@/lib/ai";
import { AI_PROVIDER_INFO } from "@/lib/ai/shared";
import { getBoardSettings } from "@/lib/boards/store";
import { listJiraBoards } from "@/lib/jira/store";
import { LanguagePicker } from "@/components/LanguagePicker";
import { TouchSettings } from "@/components/TouchSettings";
import { guardedActions, listCredentials } from "@/lib/touch";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Settings") };
}

/** Backups → Google Drive: on (the extension), signed in. */
function driveBackupView() {
  return { on: extensionInstalled("google-drive:backup-sync"), connected: isDriveConnected(), installed: isInstalled("google-drive") };
}

/** App-wide settings: the AI provider Zeff's analyses run through (the Todos tab's). */
export default async function PreferencesPage() {
  await connection();
  const board = getBoardSettings();
  const ai = aiChoice();
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("Settings")}</h1>
        <p className="text-sm text-zinc-500">
          {rich(t("Working hours and absences are on the <link>Schedule</link> page."), {
            link: (s) => (
              <Link href="/settings" className="text-indigo-600 hover:underline dark:text-indigo-400">
                {s}
              </Link>
            ),
          })}
        </p>
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
      <section className="card space-y-1 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("AI")}</h2>
        <p className="text-sm text-zinc-500">
          {isInstalled("llm")
            ? rich(t("Backends, models, your instructions and the context for all AI tasks and agents are set in the <link>LLM plugin</link>."), {
                link: (s) => (
                  <Link href="/llm" className="text-indigo-600 hover:underline dark:text-indigo-400">
                    {s}
                  </Link>
                ),
              })
            : rich(
                t(
                  "Backends, models, your instructions and the context for all AI tasks and agents are set in the <link>LLM plugin (not installed)</link>.",
                ),
                {
                  link: (s) => (
                    <Link href="/plugins" className="text-indigo-600 hover:underline dark:text-indigo-400">
                      {s}
                    </Link>
                  ),
                },
              )}
        </p>
      </section>
      <section id="boards" className="card scroll-mt-4 space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Todos (briefing)")}</h2>
          <p className="max-w-[75ch] text-sm text-zinc-500">{t("Which tickets the briefing goes through, and how often it runs by itself.")}</p>
        </div>
        <BoardSettingsForm
          jql={board.jql}
          autoMinutes={board.autoMinutes}
          boards={listJiraBoards()
            .filter((b) => b.enabled)
            .map((b) => b.name)}
          ai={`${AI_PROVIDER_INFO[ai.provider].label}${ai.model ? ` · ${ai.model}` : ""}`}
        />
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
