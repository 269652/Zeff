import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AiSettingsForm } from "@/components/AiSettingsForm";
import { BoardSettingsForm } from "@/components/boards/BoardSettingsForm";
import { BackupSettings } from "@/components/BackupSettings";
import { getBackupSettings, listBackups } from "@/lib/backup";
import { aiChoice, aiProviders, getAppSettings } from "@/lib/ai";
import { copilotModels } from "@/lib/ai/copilot";
import { AI_PROVIDER_INFO, isAiProvider, type AiProvider } from "@/lib/ai/shared";
import { getBoardSettings } from "@/lib/boards/store";
import { listJiraBoards } from "@/lib/jira/store";

export const metadata: Metadata = { title: "Settings" };

/** App-wide settings: the AI provider Zeff's analyses run through (the Boards tab's). */
export default async function PreferencesPage() {
  await connection();
  const s = getAppSettings();
  const found = Object.fromEntries(aiProviders().map((p) => [p.id, p.found])) as Record<AiProvider, string | null>;
  const board = getBoardSettings();
  const ai = aiChoice();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="text-sm text-zinc-500">
          Working hours and absences are on the{" "}
          <Link href="/settings" className="text-indigo-600 hover:underline dark:text-indigo-400">
            Schedule
          </Link>{" "}
          page.
        </p>
      </div>
      <section className="card space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">AI provider</h2>
          <p className="max-w-[75ch] text-sm text-zinc-500">
            The command-line AI that analyses for Zeff — the Boards tab&apos;s ticket summaries and todos. It runs headless and closed: the
            data goes in with the prompt, no tools, files or servers of its own. Each uses its own sign-in.
          </p>
        </div>
        <AiSettingsForm
          provider={isAiProvider(s.aiProvider) ? s.aiProvider : "claude"}
          claudeModel={s.claudeModel}
          copilotModel={s.copilotModel}
          copilotModels={found.copilot ? await copilotModels() : []}
          found={found}
        />
      </section>
      <section id="boards" className="card scroll-mt-4 space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">Boards</h2>
          <p className="max-w-[75ch] text-sm text-zinc-500">Which tickets the Ticket-Lage goes through, and how often it runs by itself.</p>
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
      <section id="backups" className="card scroll-mt-4 space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">Backups</h2>
          <p className="max-w-[75ch] text-sm text-zinc-500">
            Zeffs Daten — die Datenbank und die Dateien daneben (Kalender-Eingang, Logs der Läufe) — als ZIP, mit Passwort AES-256-verschlüsselt. Läuft von selbst; hier auch jederzeit von Hand, und hier wiederherstellen.
          </p>
        </div>
        <BackupSettings s={getBackupSettings()} backups={listBackups()} />
      </section>
    </div>
  );
}
