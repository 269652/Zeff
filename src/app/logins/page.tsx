import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { CheckAllLoginsButton, LoginButtons } from "@/components/LoginButtons";
import { listLogins, type LoginState } from "@/lib/logins";
import { agoText } from "@/lib/teams/time";

export const metadata: Metadata = { title: "Anmeldungen" };

const BADGE: Record<LoginState, [string, string]> = {
  ok: ["angemeldet", "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"],
  login: ["Anmeldung nötig", "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"],
  closed: ["nicht offen", "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"],
  chrome: ["Chrome läuft nicht", "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"],
  unknown: ["unbekannt", "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"],
};
const SOURCE = { check: "geprüft", request: "Anmeldeaufforderung", sync: "letzter Sync" } as const;

/**
 * Logins: every service the installed plugins reach through the automation Chrome, and whether
 * you're signed in there — a check asks the plugin's driver (read-only); "Anmelden" brings the
 * service's page up in that Chrome, where you sign in yourself (Zeff never types credentials).
 */
export default async function LoginsPage({ searchParams }: { searchParams: Promise<{ setup?: string }> }) {
  await connection();
  const setup = (await searchParams).setup === "1";
  const { chrome, logins } = await listLogins();
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

      {logins.length ? (
        <ul className="card divide-y divide-zinc-100 dark:divide-zinc-800">
          {logins.map((l) => {
            const [text, cls] = BADGE[l.state];
            return (
              <li key={l.service} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1 basis-80">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{l.label}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{text}</span>
                    <span className="text-xs text-zinc-400">{l.plugins.join(", ")}</span>
                  </div>
                  <p className="line-clamp-2 text-sm text-zinc-500">{l.detail}</p>
                  {l.at && l.source && (
                    <p className="text-xs text-zinc-400">
                      {SOURCE[l.source]} {agoText(l.at)}
                    </p>
                  )}
                </div>
                <LoginButtons service={l.service} label={l.label} checkable={l.checkable} />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="py-6 text-center text-sm text-zinc-500">
          Keins der installierten Plugins braucht eine Anmeldung —{" "}
          <Link href="/plugins" className="text-indigo-600 hover:underline dark:text-indigo-400">
            Plugins
          </Link>
          .
        </p>
      )}
    </div>
  );
}
