import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import Link from "next/link";
import { connection } from "next/server";
import { BetaBadge, BetaWarning, ExperimentalBadge, ExperimentalWarning } from "@/components/BetaBadge";
import { PluginExtensions, type ExtensionRow } from "@/components/PluginExtensions";
import { PluginInstallButton } from "@/components/PluginInstallButton";
import { PluginSearch } from "@/components/PluginSearch";
import { ThisPc } from "@/components/ThisPc";
import { findClaudeCli } from "@/plugins/claude-cli/cli";
import { PLUGIN_CATEGORY_LABELS, featuresOf, listedPlugins, pluginById, type PluginCategory, type PluginManifest } from "@/plugins/catalog";
import { findCopilotCli } from "@/plugins/copilot-cli/cli";
import { ExternalPlugins } from "@/components/ext/ExternalPlugins";
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
  const groups = (Object.keys(PLUGIN_CATEGORY_LABELS) as PluginCategory[]).map((c) => [c, listedPlugins().filter((p) => p.category === c)] as const);
  return (
    <div className="page">
      <div className="page-aside">
        <Link href="/settings" className="text-sm text-zinc-500 hover:underline">
          ← {t("Settings")}
        </Link>
        <h1 className="text-lg font-semibold">{t("Plugins")}</h1>
        <p className="max-w-[75ch] text-sm text-zinc-500">
          {t(
            "What connects Zeff to other systems. An uninstalled plugin takes along what it brings — menu entries, pages, syncs, sign-ins, the AI provider —; the data (mails, messages, entries read) stays.",
          )}
        </p>
      </div>
      <PluginSearch />
      <ThisPc />
      {groups.map(([category, list]) => (
        <section key={category} className="space-y-2" data-plugin-group>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{catalogText(t, PLUGIN_CATEGORY_LABELS[category])}</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {list.map((p) => {
              // Set to installed, but what it builds on isn't there: missing that.
              const installed = set.has(p.id);
              const missing = installed && !on.has(p.id) ? (p.dependsOn ?? []).filter((d) => !on.has(d)) : [];
              const found = foundOn(p);
              // What the search looks through: its name, description, id, what it needs, its group and its parts.
              const text = [p.id, p.name, p.description, p.requires ?? "", PLUGIN_CATEGORY_LABELS[category], ...featuresOf(p.id).flatMap((f) => [f.name, f.description])]
                .flatMap((x) => [x, catalogText(t, x)])
                .join(" ")
                .toLowerCase();
              return (
                <li key={p.id} data-plugin-text={text} className={`card space-y-2 p-4 ${installed ? "" : "opacity-80"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-medium">
                        {catalogText(t, p.name)}{" "}
                        {installed ? (
                          <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{t("installed")}</span>
                        ) : (
                          <span className="ml-1 rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{t("not installed")}</span>
                        )}
                        {p.defaultInstalled && <span className="ml-1 text-xs text-zinc-400">{t("Default")}</span>}
                        {p.beta && <BetaBadge warning={p.beta} />}
                        {p.experimental && <ExperimentalBadge warning={p.experimental} />}
                      </h3>
                      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{catalogText(t, p.description)}</p>
                    </div>
                    <PluginInstallButton id={p.id} installed={installed} beta={p.beta} experimental={p.experimental} />
                  </div>
                  {p.beta && <BetaWarning warning={p.beta} />}
                  {p.experimental && <ExperimentalWarning warning={p.experimental} />}
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
                  {featuresOf(p.id).length > 0 && (
                    <div className="space-y-1.5 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                      <p className="text-xs font-medium text-zinc-500">{t("Parts")}</p>
                      <ul className="space-y-2">
                        {featuresOf(p.id).map((f) => (
                          <li key={f.id} className={`flex items-start justify-between gap-3 text-sm ${set.has(f.id) ? "" : "opacity-80"}`}>
                            <span>
                              <span className="font-medium">{catalogText(t, f.name)}</span>
                              {f.defaultInstalled && <span className="ml-1 text-xs text-zinc-400">{t("Default")}</span>}
                              {f.beta && <BetaBadge warning={f.beta} />}
                              {f.experimental && <ExperimentalBadge warning={f.experimental} />}
                              <span className="block text-xs text-zinc-500">{catalogText(t, f.description)}</span>
                              {f.requires && <span className="block text-xs text-zinc-500">{t("Needs: {what}", { what: catalogText(t, f.requires) })}</span>}
                              {set.has(f.id) && !on.has(f.id) && (
                                <span className="block text-xs font-medium text-amber-700 dark:text-amber-400">
                                  {t("— not active, missing: {names}", { names: (f.dependsOn ?? []).filter((d) => !on.has(d)).map((d) => catalogText(t, pluginById(d).name)).join(", ") })}
                                </span>
                              )}
                            </span>
                            <PluginInstallButton id={f.id} installed={set.has(f.id)} beta={f.beta} experimental={f.experimental} />
                          </li>
                        ))}
                      </ul>
                      <PluginExtensions rows={featuresOf(p.id).flatMap((f) => extRows(f.id))} />
                    </div>
                  )}
                  <PluginExtensions rows={extRows(p.id)} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {/* Plugins work in Zeff; mods change Zeff itself (lib/mods) — a page of their own. */}
      <section className="card flex flex-wrap items-center gap-3 p-4 text-sm">
        <span className="min-w-0 flex-1 text-zinc-600 dark:text-zinc-300">
          <b>🧬 {t("Mods")}</b> — {t("plugins work inside Zeff (apps, functions, flows; sandboxed). Mods change Zeff itself: any of its functions and components, without touching its code.")}
        </span>
        <Link href="/mods" className="btn btn-sm">
          {t("Mods →")}
        </Link>
      </section>
      <ExternalPlugins />
    </div>
  );
}
