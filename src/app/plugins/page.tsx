import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PluginInstallButton } from "@/components/PluginInstallButton";
import { findClaudeCli } from "@/plugins/claude-cli/cli";
import { PLUGIN_CATEGORY_LABELS, PLUGINS, pluginById, type PluginCategory, type PluginManifest } from "@/plugins/catalog";
import { findCopilotCli } from "@/plugins/copilot-cli/cli";
import { chosenPlugins, installedPlugins } from "@/plugins/state";

export const metadata: Metadata = { title: "Plugins" };

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
  const groups = (Object.keys(PLUGIN_CATEGORY_LABELS) as PluginCategory[]).map((c) => [c, PLUGINS.filter((p) => p.category === c)] as const);
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">Plugins</h1>
        <p className="max-w-[75ch] text-sm text-zinc-500">
          Was Zeff mit anderen Systemen verbindet. Ein deinstalliertes Plugin nimmt mit, was es bringt — Menüeinträge, Seiten, Syncs, Anmeldungen, den KI-Anbieter —, die Daten (Mails, Nachrichten, gelesene Buchungen) bleiben.
        </p>
      </div>
      {groups.map(([category, list]) => (
        <section key={category} className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{PLUGIN_CATEGORY_LABELS[category]}</h2>
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
                        {p.name}{" "}
                        {installed ? (
                          <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">installiert</span>
                        ) : (
                          <span className="ml-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">nicht installiert</span>
                        )}
                        {p.defaultInstalled && <span className="ml-1 text-[11px] text-zinc-400">Standard</span>}
                      </h3>
                      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{p.description}</p>
                    </div>
                    <PluginInstallButton id={p.id} installed={installed} />
                  </div>
                  {p.dependsOn?.length ? (
                    <p className="text-xs text-zinc-500">
                      Baut auf: {p.dependsOn.map((d) => pluginById(d).name).join(", ")}
                      {missing.length > 0 && <span className="font-medium text-amber-700 dark:text-amber-400"> — nicht aktiv, es fehlt: {missing.map((d) => pluginById(d).name).join(", ")}</span>}
                    </p>
                  ) : null}
                  {p.requires && (
                    <p className="text-xs text-zinc-500">
                      Braucht: {p.requires}
                      {found !== undefined && (found ? <span className="text-emerald-700 dark:text-emerald-400"> · gefunden ({found})</span> : <span className="text-amber-700 dark:text-amber-400"> · auf diesem Rechner nicht gefunden</span>)}
                    </p>
                  )}
                  {(p.nav?.length || p.routes?.length || p.syncSteps?.length) && (
                    <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
                      {p.nav?.map((n) =>
                        installed ? (
                          <Link key={n.href} href={n.href} className="text-indigo-600 hover:underline dark:text-indigo-400">
                            {n.label} →
                          </Link>
                        ) : (
                          <span key={n.href}>Seite {n.label}</span>
                        ),
                      )}
                      {p.syncSteps?.length ? <span>Sync: {p.syncSteps.join(", ")}</span> : null}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
