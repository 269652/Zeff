import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import Link from "next/link";
import { connection } from "next/server";
import { BetaBadge, BetaWarning } from "@/components/BetaBadge";
import { PluginExtensions, type ExtensionRow } from "@/components/PluginExtensions";
import { PluginInstallButton } from "@/components/PluginInstallButton";
import { ThisPc } from "@/components/ThisPc";
import { findClaudeCli } from "@/plugins/claude-cli/cli";
import { PLUGIN_CATEGORY_LABELS, PLUGINS, pluginById, type PluginCategory, type PluginManifest } from "@/plugins/catalog";
import { findCopilotCli } from "@/plugins/copilot-cli/cli";
import { extensionStates } from "@/plugins/extension-state";
import { catalogText } from "@/plugins/catalog-text";
import { extensionOrigin } from "@/plugins/extensions";
import { chosenPlugins, installedPlugins } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Plugins") };
}

/** Where an AI plugin's command-line tool is on this machine (null: not found) — the others need the automation Chrome. */
function foundOn(p: PluginManifest): string | null | undefined {
  if (p.aiProvider === "claude") return findClaudeCli();
  if (p.aiProvider === "copilot") return findCopilotCli()?.where ?? null;
  return undefined;
}

/**
 * Zeff's plugins — the connectors (Outlook, Teams, GitLab), the time-sheet systems (Chrono, Punch)
 * and the AI tools (Copilot CLI, Claude CLI): each installed or not. Uninstalled, what it brings
 * (menu entries, pages, syncs, sign-ins, the AI provider) is gone; its data stays.
 */
export default async function PluginsPage() {
  await connection();
  const on = installedPlugins();
  const set = chosenPlugins();
  // Extensions: under the plugin they extend; the plugin bringing them names where they go.
  const exts = extensionStates();
  const extRows = (host: string): ExtensionRow[] =>
    exts
      .filter((s) => s.ext.for === host)
      .map((s) => ({ id: s.ext.id, name: catalogText(t, s.ext.name), description: catalogText(t, s.ext.description), origin: extensionOrigin(s.ext, t), available: s.available, missing: s.missing.map((m) => catalogText(t, pluginById(m).name)), chosen: s.chosen, installed: s.installed, defaultInstalled: s.ext.defaultInstalled }));
  const brings = (by: string) => [...new Set(exts.filter((s) => s.ext.by === by).map((s) => catalogText(t, pluginById(s.ext.for).name)))];
  const groups = (Object.keys(PLUGIN_CATEGORY_LABELS) as PluginCategory[]).map((c) => [c, PLUGINS.filter((p) => p.category === c)] as const);
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("Plugins")}</h1>
        <p className="max-w-[75ch] text-sm text-zinc-500">
          {t(
            "What connects Zeff to other systems. An uninstalled plugin takes along what it brings — menu entries, pages, syncs, sign-ins, the AI provider —; the data (mails, messages, entries read) stays.",
          )}
        </p>
      </div>
      <ThisPc />
      {groups.map(([category, list]) => (
        <section key={category} className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{catalogText(t, PLUGIN_CATEGORY_LABELS[category])}</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {list.map((p) => {
              // Set to installed, but what it builds on isn't there: missing that.
              const installed = set.has(p.id);
              const missing = installed && !on.has(p.id) ? (p.dependsOn ?? []).filter((d) => !on.has(d)) : [];
              const found = foundOn(p);
              return (
                <li key={p.id} className={`card space-y-2 p-4 ${installed ? "" : "opacity-80"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-medium">
                        {catalogText(t, p.name)}{" "}
                        {installed ? (
                          <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{t("installed")}</span>
                        ) : (
                          <span className="ml-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{t("not installed")}</span>
                        )}
                        {p.defaultInstalled && <span className="ml-1 text-[11px] text-zinc-400">{t("Default")}</span>}
                        {p.beta && <BetaBadge warning={p.beta} />}
                      </h3>
                      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{catalogText(t, p.description)}</p>
                    </div>
                    <PluginInstallButton id={p.id} installed={installed} beta={p.beta} />
                  </div>
                  {p.beta && <BetaWarning warning={p.beta} />}
                  {p.dependsOn?.length ? (
                    <p className="text-xs text-zinc-500">
                      {t("Builds on: {names}", { names: p.dependsOn.map((d) => catalogText(t, pluginById(d).name)).join(", ") })}
                      {missing.length > 0 && (
                        <span className="font-medium text-amber-700 dark:text-amber-400"> {t("— not active, missing: {names}", { names: missing.map((d) => catalogText(t, pluginById(d).name)).join(", ") })}</span>
                      )}
                    </p>
                  ) : null}
                  {p.requires && (
                    <p className="text-xs text-zinc-500">
                      {t("Needs: {what}", { what: catalogText(t, p.requires) })}
                      {found !== undefined &&
                        (found ? (
                          <span className="text-emerald-700 dark:text-emerald-400"> · {t("found ({where})", { where: found })}</span>
                        ) : (
                          <span className="text-amber-700 dark:text-amber-400"> · {t("not found on this computer")}</span>
                        ))}
                    </p>
                  )}
                  {brings(p.id).length > 0 && <p className="text-xs text-zinc-500">{t("Brings extensions for: {names}", { names: brings(p.id).join(", ") })}</p>}
                  {(p.nav?.length || p.routes?.length || p.syncSteps?.length) && (
                    <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
                      {p.nav?.map((n) =>
                        installed ? (
                          <Link key={n.href} href={n.href} className="text-indigo-600 hover:underline dark:text-indigo-400">
                            {catalogText(t, n.label)} →
                          </Link>
                        ) : (
                          <span key={n.href}>{t("Page {name}", { name: catalogText(t, n.label) })}</span>
                        ),
                      )}
                      {p.syncSteps?.length ? <span>{t("Sync: {steps}", { steps: p.syncSteps.join(", ") })}</span> : null}
                    </p>
                  )}
                  <PluginExtensions rows={extRows(p.id)} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
