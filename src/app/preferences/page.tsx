import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import { availableLanguages, t } from "@/lib/i18n/server";
import Link from "next/link";
import { connection } from "next/server";
import { BoardSettingsForm } from "@/components/boards/BoardSettingsForm";
import { BackupSettings } from "@/plugins/backup/BackupSettings";
import { getBackupSettings, listBackups } from "@/plugins/backup/backup";
import { aiChoice } from "@/lib/ai";
import { AI_PROVIDER_INFO } from "@/lib/ai/shared";
import { getBoardSettings } from "@/lib/boards/store";
import { listJiraBoards } from "@/lib/jira/store";
import { LanguagePicker } from "@/components/LanguagePicker";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Settings") };
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
          {t("Working hours and absences are on the")}{" "}
          <Link href="/settings" className="text-indigo-600 hover:underline dark:text-indigo-400">
            {t("Schedule")}
          </Link>{" "}
          {t("page.")}
        </p>
      </div>
      <section id="language" className="card scroll-mt-4 space-y-2 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Language")}</h2>
        <p className="text-sm text-zinc-500">
          {t("The language Zeff speaks in this account — from the installed language bundles (")}
          <Link href="/plugins" className="text-indigo-600 hover:underline dark:text-indigo-400">
            {t("Plugins")}
          </Link>
          {t("). Dates and numbers follow it.")}
        </p>
        <LanguagePicker available={availableLanguages()} />
      </section>
      <section className="card space-y-1 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("AI")}</h2>
        <p className="text-sm text-zinc-500">
          {t("Backends, models, your instructions and the context for all AI tasks and agents are set in the")}{" "}
          {isInstalled("llm") ? (
            <Link href="/llm" className="text-indigo-600 hover:underline dark:text-indigo-400">
              {t("LLM plugin")}
            </Link>
          ) : (
            <Link href="/plugins" className="text-indigo-600 hover:underline dark:text-indigo-400">
              {t("LLM plugin (not installed)")}
            </Link>
          )}
          .
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
          <BackupSettings s={getBackupSettings()} backups={listBackups()} />
        </section>
      )}
    </div>
  );
}
