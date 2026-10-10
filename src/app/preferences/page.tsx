import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { BoardSettingsForm } from "@/components/boards/BoardSettingsForm";
import { BackupSettings } from "@/plugins/backup/BackupSettings";
import { getBackupSettings, listBackups } from "@/plugins/backup/backup";
import { aiChoice } from "@/lib/ai";
import { AI_PROVIDER_INFO } from "@/lib/ai/shared";
import { getBoardSettings } from "@/lib/boards/store";
import { listJiraBoards } from "@/lib/jira/store";

export const metadata: Metadata = { title: "Settings" };

/** App-wide settings: the AI provider Zeff's analyses run through (the Todos tab's). */
export default async function PreferencesPage() {
  await connection();
  const board = getBoardSettings();
  const ai = aiChoice();
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="text-sm text-zinc-500">
          Working hours and absences are on the{" "}
          <Link href="/settings" className="text-indigo-600 hover:underline dark:text-indigo-400">
            Schedule
          </Link>{" "}
          page.
        </p>
      </div>
      <section className="card space-y-1 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">KI</h2>
        <p className="text-sm text-zinc-500">
          Backends, Modelle, deine Anweisungen und den Kontext für alle KI-Aufgaben und Agenten stellst du im{" "}
          {isInstalled("llm") ? (
            <Link href="/llm" className="text-indigo-600 hover:underline dark:text-indigo-400">
              LLM-Plugin
            </Link>
          ) : (
            <Link href="/plugins" className="text-indigo-600 hover:underline dark:text-indigo-400">
              LLM-Plugin (nicht installiert)
            </Link>
          )}{" "}
          ein.
        </p>
      </section>
      <section id="boards" className="card scroll-mt-4 space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">Todos (Ticket-Lage)</h2>
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
      {isInstalled("backup") && (
        <section id="backups" className="card scroll-mt-4 space-y-3 p-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-500 uppercase">Backups</h2>
            <p className="max-w-[75ch] text-sm text-zinc-500">
              Zeffs Daten — die Datenbank und die Dateien daneben (Kalender-Eingang, Logs der Läufe) — als ZIP, mit Passwort AES-256-verschlüsselt. Läuft von selbst; hier auch jederzeit von Hand, und hier wiederherstellen.
            </p>
          </div>
          <BackupSettings s={getBackupSettings()} backups={listBackups()} />
        </section>
      )}
    </div>
  );
}
