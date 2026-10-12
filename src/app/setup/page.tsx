import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
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
import { ThisPc } from "@/components/ThisPc";
import { PLUGIN_CATEGORY_LABELS, PLUGINS, type PluginCategory } from "@/plugins/catalog";
import { catalogText } from "@/plugins/catalog-text";
import { chosenPlugins, installedPlugins } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Setup") };
}

const STEPS = [{ id: "plugins" }, { id: "configure" }, { id: "sync" }, { id: "logins" }, { id: "data" }, { id: "done" }] as const;
type StepId = (typeof STEPS)[number]["id"];
const stepLabels = (): Record<StepId, string> => ({
  plugins: t("Plugins"),
  configure: t("Configure"),
  sync: t("Syncs"),
  logins: t("Sign-ins"),
  data: t("Fetch & evaluate data"),
  done: t("Done"),
});

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
  const labels = stepLabels();

  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{from ? t("Set up “{name}”", { name: currentAccount().name }) : t("Set up Zeff")}</h1>
        <ol className="space-y-1 text-sm">
          {STEPS.map((s, i) => (
            <li key={s.id}>
              <Link href={`/setup?step=${s.id}`} className={`flex gap-2 rounded px-2 py-1 ${s.id === step ? "bg-zinc-200 font-medium dark:bg-zinc-800" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}>
                <span className="w-4 text-right tabular-nums">{i + 1}.</span> {labels[s.id]}
              </Link>
            </li>
          ))}
        </ol>
        <form action={skipSetupAction}>
          <button type="submit" className="text-xs text-zinc-400 hover:text-zinc-600 hover:underline">
            {t("Skip — later under Menu → Plugins, Sync settings, Sign-ins")}
          </button>
        </form>
      </div>

      {from && step === "plugins" && (
        <section className="card border-indigo-200 bg-indigo-50 p-4 text-sm dark:border-indigo-900 dark:bg-indigo-950/40">
          <p className="font-medium">{t("A copy of “{name}”.", { name: from.name })}</p>
          <p className="text-zinc-600 dark:text-zinc-300">
            {from.sharedChrome
              ? t(
                  "Plugins, settings, menu and sync intervals are taken over, the sign-ins too (the automation Chrome of “{name}”) — only the data is still missing. Look through what you want to change, or skip straight ahead.",
                  { name: from.name },
                )
              : t("Plugins, settings, menu and sync intervals are taken over — only the data is still missing. Look through what you want to change, or skip straight ahead.")}
          </p>
          <Link href={`/setup?step=${from.sharedChrome ? "data" : "logins"}`} className="btn btn-primary btn-sm mt-2">
            {from.sharedChrome ? t("Straight to: fetch & evaluate data") : t("Straight to: the sign-ins")}
          </Link>
        </section>
      )}

      {step === "plugins" && (
        <>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {t("What should Zeff do, and what should it connect to? Install what you need — you can change it any time later under Menu → Plugins.")}
          </p>
          {(Object.keys(PLUGIN_CATEGORY_LABELS) as PluginCategory[]).map((c) => {
            const list = PLUGINS.filter((p) => p.category === c);
            return list.length ? (
              <section key={c} className="space-y-2">
                <h2 className="text-sm font-semibold text-zinc-500 uppercase">{catalogText(t, PLUGIN_CATEGORY_LABELS[c])}</h2>
                <ul className="card divide-y divide-zinc-100 dark:divide-zinc-800">
                  {list.map((p) => (
                    <li key={p.id} className="flex items-start gap-4 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{catalogText(t, p.name)}</div>
                        <p className="text-sm text-zinc-500">{catalogText(t, p.description)}</p>
                        {p.requires && <p className="text-xs text-zinc-400">{t("Needs: {what}", { what: catalogText(t, p.requires) })}</p>}
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
          <ThisPc />
          <p className="text-sm text-zinc-600 dark:text-zinc-300">{t("The installed plugins with settings — go through them (each opens in a new tab), then continue.")}</p>
          <ul className="card divide-y divide-zinc-100 dark:divide-zinc-800">
            {PLUGINS.filter((p) => on.has(p.id) && p.settings).map((p) => (
              <li key={p.id} className="flex items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{catalogText(t, p.name)}</div>
                  <p className="text-sm text-zinc-500">{catalogText(t, p.settings!.what)}</p>
                </div>
                <a href={p.settings!.href} target="_blank" rel="noreferrer" className="btn btn-sm">
                  {t("Settings")}
                </a>
              </li>
            ))}
            {!PLUGINS.some((p) => on.has(p.id) && p.settings) && <li className="px-4 py-3 text-sm text-zinc-500">{t("None of the installed plugins needs settings.")}</li>}
          </ul>
        </>
      )}

      {step === "sync" && (
        <>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">{t("How often each sync runs by itself — the defaults usually fit; later under Menu → Sync settings.")}</p>
          <SyncSettingsList />
        </>
      )}

      {step === "logins" && (
        <>
          <section className="space-y-2 text-sm">
            <p className="text-zinc-600 dark:text-zinc-300">
              {from?.sharedChrome
                ? t(
                    "Sign in to the services the plugins read — in this account's automation Chrome (the one of “{name}”: you're signed in there already — “Check all” shows it). “Sign in” brings the site to the front there; you sign in yourself, then “Check”.",
                    { name: from.name },
                  )
                : t("Sign in to the services the plugins read — in this account's automation Chrome. “Sign in” brings the site to the front there; you sign in yourself, then “Check”.")}
            </p>
            <CheckAllLoginsButton />
          </section>
          <LoginsList />
        </>
      )}

      {step === "data" && (
        <>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {t("Now Zeff fetches everything the plugins read — tickets, mails, chats, calendars, entries… — and evaluates it for the first time: the briefing with its todos.")}
          </p>
          <SetupDataRun next="/setup?step=done" />
        </>
      )}

      {step === "done" && (
        <section className="card space-y-3 p-4 text-sm">
          <p className="font-medium">{t("All set up.")}</p>
          <p className="text-zinc-600 dark:text-zinc-300">
            {t("From now on the syncs run by themselves (Menu → Sync settings); a new briefing can be run any time on the Todos tab. Everything can be changed later under Menu → Plugins.")}
          </p>
          <form action={finishSetupAction}>
            <button type="submit" className="btn btn-primary btn-sm">
              {t("To the todos")}
            </button>
          </form>
        </section>
      )}

      {next && step !== "data" && step !== "done" && (
        <div className="flex justify-end">
          <Link href={`/setup?step=${next.id}`} className="btn btn-primary btn-sm">
            {t("Next: {step}", { step: labels[next.id] })}
          </Link>
        </div>
      )}
    </div>
  );
}
