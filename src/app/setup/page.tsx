import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import Link from "next/link";
import { connection } from "next/server";
import { finishSetupAction, skipSetupAction } from "@/app/actions";
import { CheckAllLoginsButton, OpenAllSignInsButton } from "@/components/LoginButtons";
import { LanguagePicker } from "@/components/LanguagePicker";
import { availableLanguages } from "@/lib/i18n/server";
import { aiChoice, aiProviders } from "@/lib/ai";
import { aiProviderInfo } from "@/lib/ai/shared";
import { LoginsList } from "@/components/LoginsList";
import { PluginInstallButton } from "@/components/PluginInstallButton";
import { SetupDataRun } from "@/components/SetupDataRun";
import { SetupChoices } from "@/components/SetupChoices";
import { DemoButton } from "@/components/DemoButton";
import { isDemoAccount } from "@/db/accounts";
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

const STEPS = [{ id: "start" }, { id: "plugins" }, { id: "configure" }, { id: "sync" }, { id: "logins" }, { id: "data" }, { id: "done" }] as const;
type StepId = (typeof STEPS)[number]["id"];
const stepLabels = (): Record<StepId, string> => ({
  start: t("What you use"),
  plugins: t("All plugins"),
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
  const step: StepId = STEPS.some((s) => s.id === sp.step) ? (sp.step as StepId) : "start";
  const n = STEPS.findIndex((s) => s.id === step);
  const next = STEPS[n + 1];
  const on = installedPlugins();
  const set = chosenPlugins();
  const from = getPref<{ id: string; name: string; sharedChrome: boolean } | null>("setup:from", null);
  const labels = stepLabels();
  const prev = n > 0 ? STEPS[n - 1] : null;
  // Before the first AI run: is there an AI to run it (its CLI found, the local AI's address set)?
  const ai = step === "data" && on.has("llm") ? aiChoice().provider : null;
  const aiFound = ai ? aiProviders().some((p) => p.id === ai && p.found) : true;
  // What a step is for, in a line (under its name).
  const intro: Record<StepId, string> = {
    start: t("Tick what you use — Zeff installs what reads it. Every other feature is in the next step; all of it can be changed later."),
    plugins: t("Everything Zeff can do. Install what you need — later under Menu → Plugins too."),
    configure: t("The programs Zeff uses on this PC, and the settings of the installed plugins (each opens in a new tab)."),
    sync: t("How often each sync runs by itself — the defaults usually fit; later under Menu → Sync settings."),
    logins: t("Sign in to the services the plugins read — in this account's automation Chrome. “Sign in” brings the site to the front there; you sign in yourself, then “Check”."),
    data: t("Now Zeff fetches everything the plugins read — tickets, mails, chats, calendars, entries… — and evaluates it for the first time: the briefing with its todos."),
    done: "",
  };
  // At the end: how many todos the first run derived.
  const openTodos = step === "done" && on.has("todos") ? (await import("@/lib/todos/store")).listTodos({ status: "open" }).length : 0;

  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{from ? t("Set up “{name}”", { name: currentAccount().name }) : t("Set up Zeff")}</h1>
        {/* The steps as a list beside the page; on a phone the bar above the step says where you are. */}
        <ol className="hidden space-y-1 text-sm lg:block">
          {STEPS.map((s, i) => (
            <li key={s.id}>
              <Link href={`/setup?step=${s.id}`} className={`flex gap-2 rounded px-2 py-1 ${s.id === step ? "bg-zinc-200 font-medium dark:bg-zinc-800" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}>
                <span className="w-4 text-right tabular-nums">{i + 1}.</span> {labels[s.id]}
              </Link>
            </li>
          ))}
        </ol>
        {!isDemoAccount() && (
          <DemoButton to="demo" label={t("Look around with sample data first")} className="text-left text-xs text-indigo-700 hover:underline dark:text-indigo-300" />
        )}
        <form action={skipSetupAction}>
          <button type="submit" className="text-left text-xs text-zinc-500 hover:text-zinc-700 hover:underline dark:hover:text-zinc-300">
            {t("Skip — later under Menu → Plugins, Sync settings, Sign-ins")}
          </button>
        </form>
      </div>

      <header className="space-y-2">
        <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{t("Step {n} of {total}", { n: n + 1, total: STEPS.length })}</p>
        <h2 className="text-xl font-semibold">{labels[step]}</h2>
        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={n + 1} aria-label={t("Setup progress")}>
          <div className="h-full rounded-full bg-indigo-600 transition-[width] dark:bg-indigo-400" style={{ width: `${Math.round(((n + 1) / STEPS.length) * 100)}%` }} />
        </div>
        {intro[step] && !(step === "logins" && from?.sharedChrome) && <p className="text-sm text-zinc-600 dark:text-zinc-300">{intro[step]}</p>}
      </header>

      {from && step === "start" && (
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

      {step === "start" && (
        <>
          {/* The language first: everything after it is in it. */}
          <section className="card flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-4">
            <span className="text-sm font-medium">{t("Language")}</span>
            <LanguagePicker available={availableLanguages()} />
          </section>
          <SetupChoices installed={[...set]} />
        </>
      )}

      {step === "plugins" && (
        <>
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
          <ul className="card divide-y divide-zinc-100 dark:divide-zinc-800">
            {PLUGINS.filter((p) => on.has(p.id) && p.settings && !p.id.startsWith("lang-")).map((p) => (
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
            {!PLUGINS.some((p) => on.has(p.id) && p.settings && !p.id.startsWith("lang-")) && <li className="px-4 py-3 text-sm text-zinc-500">{t("None of the installed plugins needs settings.")}</li>}
          </ul>
        </>
      )}

      {step === "sync" && (
        <>
          <SyncSettingsList />
        </>
      )}

      {step === "logins" && (
        <>
          <section className="space-y-2 text-sm">
            <p className="text-zinc-600 dark:text-zinc-300">
              {from?.sharedChrome &&
                t(
                  "Sign in to the services the plugins read — in this account's automation Chrome (the one of “{name}”: you're signed in there already — “Check all” shows it). “Sign in” brings the site to the front there; you sign in yourself, then “Check”.",
                  { name: from.name },
                )}
            </p>
            <div className="flex flex-wrap gap-2">
              <OpenAllSignInsButton />
              <CheckAllLoginsButton />
            </div>
          </section>
          <LoginsList />
        </>
      )}

      {step === "data" && (
        <>
          {!on.has("llm") ? (
            <p role="status" className="card border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
              {t("No AI is chosen yet — the data is fetched, but nothing evaluates it. Choose one in step 1 (“The AI that reads it for you”).")}{" "}
              <Link href="/setup?step=start" className="font-medium text-indigo-700 underline dark:text-indigo-300">{t("To step 1")}</Link>
            </p>
          ) : (
            !aiFound &&
            ai && (
              <p role="status" className="card border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
                {t("{ai} isn't found on this PC yet — the AI steps would fail. {how}", { ai: aiProviderInfo(t)[ai].label, how: aiProviderInfo(t)[ai].install })}{" "}
                <Link href="/setup?step=configure" className="font-medium text-indigo-700 underline dark:text-indigo-300">{t("To “This PC”")}</Link>
              </p>
            )
          )}
          <SetupDataRun next="/setup?step=done" />
        </>
      )}

      {step === "done" && (
        <section className="card space-y-3 p-4 text-sm">
          <p className="font-medium">{t("All set up.")}</p>
          {openTodos > 0 && (
            <p className="text-base">
              {t("Zeff found {n} todos in what came in — each with where it is from, why, and a ready action.", { n: openTodos })}
            </p>
          )}
          <p className="text-zinc-600 dark:text-zinc-300">
            {t("From now on the syncs run by themselves (Menu → Sync settings); a new briefing can be run any time on the Todos tab. Everything can be changed later under Menu → Plugins.")}
          </p>
          <p className="text-zinc-600 dark:text-zinc-300">
            {t("Good to know:")}{" "}
            <Link href="/preferences#backups" className="text-indigo-600 hover:underline dark:text-indigo-400">{t("Backups")}</Link> ·{" "}
            <Link href="/privacy" className="text-indigo-600 hover:underline dark:text-indigo-400">{t("What leaves this PC")}</Link> ·{" "}
            <Link href="/diagnostics" className="text-indigo-600 hover:underline dark:text-indigo-400">{t("Diagnostics")}</Link>
          </p>
          <form action={finishSetupAction}>
            <button type="submit" className="btn btn-primary btn-sm">
              {t("To the todos")}
            </button>
          </form>
        </section>
      )}

      <nav className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800" aria-label={t("Setup steps")}>
        {prev ? (
          <Link href={`/setup?step=${prev.id}`} className="btn btn-sm">
            ← {t("Back")}
          </Link>
        ) : (
          <span />
        )}
        {next && step !== "data" && step !== "done" && (
          <Link href={`/setup?step=${next.id}`} className="btn btn-primary">
            {t("Next: {step}", { step: labels[next.id] })} →
          </Link>
        )}
      </nav>
    </div>
  );
}
