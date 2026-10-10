import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { CheckAllLoginsButton } from "@/components/LoginButtons";
import { LoginsList } from "@/components/LoginsList";
import { listLogins } from "@/lib/logins";

export const metadata: Metadata = { title: "Anmeldungen" };

/**
 * Logins: every service the installed plugins reach through the automation Chrome, and whether
 * you're signed in there — a check asks the plugin's driver (read-only); "Anmelden" brings the
 * service's page up in that Chrome, where you sign in yourself (Zeff never types credentials).
 */
export default async function LoginsPage({ searchParams }: { searchParams: Promise<{ setup?: string }> }) {
  await connection();
  const setup = (await searchParams).setup === "1";
  const { chrome } = await listLogins();
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">Anmeldungen</h1>
        <p className="text-sm text-zinc-500">
          Wo die installierten Plugins lesen (und auf deinen Klick schreiben): jede Seite im Automations-Chrome dieses Kontos. „Anmelden“ holt sie dort nach vorne — anmelden tust du dich selbst, Zeff gibt
          keine Zugangsdaten ein. „Prüfen“ fragt das Plugin, ob die Anmeldung steht, und öffnet nichts.
        </p>
        <p className="text-xs text-zinc-400">
          Automations-Chrome: {chrome.endpoint} — {chrome.running ? "läuft" : "läuft nicht („Anmelden“ startet ihn)"}
        </p>
        <CheckAllLoginsButton />
      </div>

      {setup && (
        <section className="card border-indigo-200 bg-indigo-50 p-4 text-sm dark:border-indigo-900 dark:bg-indigo-950/40">
          <p className="font-medium">Letzter Schritt der Einrichtung: melde dich bei jedem Dienst an.</p>
          <p className="text-zinc-600 dark:text-zinc-300">
            Für jeden Eintrag „Anmelden“, im Automations-Chrome anmelden, dann „Prüfen“. Danach{" "}
            <Link href="/" className="text-indigo-600 hover:underline dark:text-indigo-400">
              los geht’s
            </Link>
            .
          </p>
        </section>
      )}

      <LoginsList />
    </div>
  );
}
