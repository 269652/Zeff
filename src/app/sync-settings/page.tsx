import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { SyncSettingsList } from "@/components/SyncSettingsList";

export const metadata: Metadata = { title: "Sync-Einstellungen" };

/**
 * Sync settings: how often each sync runs by itself — all in one place. Each installed plugin
 * brings its part (its settings module: src/plugins/<id>/sync-settings.ts); a sync two plugins
 * share (Mail) shows once.
 */
export default async function SyncSettingsPage() {
  await connection();
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">Sync-Einstellungen</h1>
        <p className="text-sm text-zinc-500">
          Wie oft jeder Sync von selbst läuft — jedes installierte Plugin bringt seinen Teil mit. Von selbst läuft nichts zwischen 19 und 8 Uhr; „Sync now“ und das Sync-Menü gehen immer.
        </p>
        <p className="text-sm text-zinc-500">
          Was ein Sync braucht, um zu lesen — die Anmeldung im Automations-Chrome —, steht unter{" "}
          <Link href="/logins" className="text-indigo-600 hover:underline dark:text-indigo-400">
            Anmeldungen
          </Link>
          .
        </p>
      </div>

      <SyncSettingsList />
    </div>
  );
}
