import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { finishSetupAction, skipSetupAction } from "@/app/actions";
import { PluginInstallButton } from "@/components/PluginInstallButton";
import { SyncSettingsList } from "@/components/SyncSettingsList";
import { PLUGIN_CATEGORY_LABELS, PLUGINS, type PluginCategory } from "@/plugins/catalog";
import { chosenPlugins, installedPlugins } from "@/plugins/state";

export const metadata: Metadata = { title: "Einrichtung" };

const STEPS = [
  { id: "plugins", label: "Plugins" },
  { id: "configure", label: "Einrichten" },
  { id: "sync", label: "Syncs" },
  { id: "logins", label: "Anmeldungen" },
] as const;
type StepId = (typeof STEPS)[number]["id"];

/**
 * The setup assistant — a new Zeff (or account) starts here: the plugins chosen, each set up on
 * its settings page, how often the syncs run, and last the sign-ins (the Logins page).
 */
export default async function SetupPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  await connection();
  const sp = await searchParams;
  const step: StepId = STEPS.some((s) => s.id === sp.step) ? (sp.step as StepId) : "plugins";
  const n = STEPS.findIndex((s) => s.id === step);
  const next = STEPS[n + 1];
  const on = installedPlugins();
  const set = chosenPlugins();

  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">Zeff einrichten</h1>
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
        <section className="card space-y-3 p-4 text-sm">
          <p>
            Fast fertig. Zuletzt meldest du dich bei den Diensten an, die die Plugins lesen — im Automations-Chrome dieses Kontos. Die Seite <span className="font-medium">Anmeldungen</span> zeigt jeden
            mit seinem Stand und holt seine Seite auf Knopfdruck nach vorne.
          </p>
          <form action={finishSetupAction}>
            <button type="submit" className="btn btn-primary btn-sm">
              Einrichtung abschließen — zu den Anmeldungen
            </button>
          </form>
        </section>
      )}

      {next && (
        <div className="flex justify-end">
          <Link href={`/setup?step=${next.id}`} className="btn btn-primary btn-sm">
            Weiter: {next.label}
          </Link>
        </div>
      )}
    </div>
  );
}
