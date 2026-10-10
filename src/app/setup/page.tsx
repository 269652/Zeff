import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { finishSetupAction, skipSetupAction } from "@/app/actions";
import { CheckAllLoginsButton } from "@/components/LoginButtons";
import { LoginsList } from "@/components/LoginsList";
import { PluginInstallButton } from "@/components/PluginInstallButton";
import { SetupDataRun } from "@/components/SetupDataRun";
import { currentAccount } from "@/db/accounts";
import { getPref } from "@/lib/prefs";
import { SyncSettingsList } from "@/components/SyncSettingsList";
import { PLUGIN_CATEGORY_LABELS, PLUGINS, type PluginCategory } from "@/plugins/catalog";
import { chosenPlugins, installedPlugins } from "@/plugins/state";

export const metadata: Metadata = { title: "Einrichtung" };

const STEPS = [
  { id: "plugins", label: "Plugins" },
  { id: "configure", label: "Einrichten" },
  { id: "sync", label: "Syncs" },
  { id: "logins", label: "Anmeldungen" },
  { id: "data", label: "Daten holen & auswerten" },
  { id: "done", label: "Fertig" },
] as const;
type StepId = (typeof STEPS)[number]["id"];

/**
 * The setup assistant — a new Zeff (or account) starts here: the plugins chosen, each set up on
 * its settings page, how often the syncs run, the sign-ins, then all data read and reviewed once.
 * An account made from another has all that but the data already: it says so, and where to go on.
 */
export default async function SetupPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  await connection();
  const sp = await searchParams;
  const step: StepId = STEPS.some((s) => s.id === sp.step) ? (sp.step as StepId) : "plugins";
  const n = STEPS.findIndex((s) => s.id === step);
  const next = STEPS[n + 1];
  const on = installedPlugins();
  const set = chosenPlugins();
  const from = getPref<{ id: string; name: string; sharedChrome: boolean } | null>("setup:from", null);

  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{from ? `„${currentAccount().name}“ einrichten` : "Zeff einrichten"}</h1>
        <ol className="space-y-1 text-sm">
          {STEPS.map((s, i) => (
            <li key={s.id}>
              <Link href={`/setup?step=${s.id}`} className={`flex gap-2 rounded px-2 py-1 ${s.id === step ? "bg-zinc-200 font-medium dark:bg-zinc-800" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}>
                <span className="w-4 text-right tabular-nums">{i + 1}.</span> {s.label}
              </Link>
            </li>
          ))}
        </ol>
        <form action={skipSetupAction}>
          <button type="submit" className="text-xs text-zinc-400 hover:text-zinc-600 hover:underline">
            Überspringen — später unter Menü → Plugins, Sync-Einstellungen, Anmeldungen
          </button>
        </form>
      </div>

      {from && step === "plugins" && (
        <section className="card border-indigo-200 bg-indigo-50 p-4 text-sm dark:border-indigo-900 dark:bg-indigo-950/40">
          <p className="font-medium">Eine Kopie von „{from.name}“.</p>
          <p className="text-zinc-600 dark:text-zinc-300">
            Plugins, Einstellungen, Menü und Sync-Intervalle sind übernommen{from.sharedChrome ? `, die Anmeldungen auch (der Automations-Chrome von „${from.name}“)` : ""} — nur die Daten fehlen noch. Schau
            durch, was du ändern willst, oder spring direkt weiter.
          </p>
          <Link href={`/setup?step=${from.sharedChrome ? "data" : "logins"}`} className="btn btn-primary btn-sm mt-2">
            {from.sharedChrome ? "Direkt: Daten holen & auswerten" : "Direkt: zu den Anmeldungen"}
          </Link>
        </section>
      )}

      {step === "plugins" && (
        <>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">Was soll Zeff können, womit verbunden sein? Installier, was du brauchst — das geht später jederzeit unter Menü → Plugins.</p>
          {(Object.keys(PLUGIN_CATEGORY_LABELS) as PluginCategory[]).map((c) => {
            const list = PLUGINS.filter((p) => p.category === c);
            return list.length ? (
              <section key={c} className="space-y-2">
                <h2 className="text-sm font-semibold text-zinc-500 uppercase">{PLUGIN_CATEGORY_LABELS[c]}</h2>
                <ul className="card divide-y divide-zinc-100 dark:divide-zinc-800">
                  {list.map((p) => (
                    <li key={p.id} className="flex items-start gap-4 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{p.name}</div>
                        <p className="text-sm text-zinc-500">{p.description}</p>
                        {p.requires && <p className="text-xs text-zinc-400">Braucht: {p.requires}</p>}
                      </div>
                      <PluginInstallButton id={p.id} installed={set.has(p.id)} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null;
          })}
        </>
      )}

      {step === "configure" && (
        <>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">Die installierten Plugins mit Einstellungen — geh sie durch (jede öffnet sich in einem neuen Tab), dann weiter.</p>
          <ul className="card divide-y divide-zinc-100 dark:divide-zinc-800">
            {PLUGINS.filter((p) => on.has(p.id) && p.settings).map((p) => (
              <li key={p.id} className="flex items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{p.name}</div>
                  <p className="text-sm text-zinc-500">{p.settings!.what}</p>
                </div>
                <a href={p.settings!.href} target="_blank" rel="noreferrer" className="btn btn-sm">
                  Einstellungen
                </a>
              </li>
            ))}
            {!PLUGINS.some((p) => on.has(p.id) && p.settings) && <li className="px-4 py-3 text-sm text-zinc-500">Keins der installierten Plugins braucht Einstellungen.</li>}
          </ul>
        </>
      )}

      {step === "sync" && (
        <>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">Wie oft jeder Sync von selbst läuft — die Vorgaben passen meist; später unter Menü → Sync-Einstellungen.</p>
          <SyncSettingsList />
        </>
      )}

      {step === "logins" && (
        <>
          <section className="space-y-2 text-sm">
            <p className="text-zinc-600 dark:text-zinc-300">
              Melde dich bei den Diensten an, die die Plugins lesen — im Automations-Chrome dieses Kontos{from?.sharedChrome ? ` (dem von „${from.name}“: dort ist schon angemeldet — „Alle prüfen“ zeigt es)` : ""}. „Anmelden“ holt die Seite dort nach vorne; anmelden tust du dich selbst, dann „Prüfen“.
            </p>
            <CheckAllLoginsButton />
          </section>
          <LoginsList />
        </>
      )}

      {step === "data" && (
        <>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">Jetzt holt Zeff alles, was die Plugins lesen — Tickets, Mails, Chats, Kalender, Buchungen … — und wertet es zum ersten Mal aus: die Ticket-Lage mit ihren Todos.</p>
          <SetupDataRun next="/setup?step=done" />
        </>
      )}

      {step === "done" && (
        <section className="card space-y-3 p-4 text-sm">
          <p className="font-medium">Fertig eingerichtet.</p>
          <p className="text-zinc-600 dark:text-zinc-300">Die Syncs laufen ab jetzt von selbst (Menü → Sync-Einstellungen); „Jetzt auswerten“ unter Todos holt eine neue Lage. Ändern lässt sich alles später unter Menü → Plugins.</p>
          <form action={finishSetupAction}>
            <button type="submit" className="btn btn-primary btn-sm">
              Zu den Todos
            </button>
          </form>
        </section>
      )}

      {next && step !== "data" && step !== "done" && (
        <div className="flex justify-end">
          <Link href={`/setup?step=${next.id}`} className="btn btn-primary btn-sm">
            Weiter: {next.label}
          </Link>
        </div>
      )}
    </div>
  );
}
