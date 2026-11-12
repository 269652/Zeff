import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { grantFunctionAction, revokeGrantAction, saveNotebookSettingsAction, webhookSecretAction } from "@/plugins/notebook/server-actions";
import { declaredFunctions } from "@/plugins/notebook/functions";
import { webhookSecret } from "@/plugins/notebook/webhooks";
import { needsGranted } from "@/plugins/notebook/grants";
import { allGrants } from "@/plugins/notebook/grants";
import { cellTimeoutSeconds, languageStatuses, memoryLimit, networkAllowed, notebookEnabled } from "@/plugins/notebook/runtimes";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Notebook") };
}

const field = "rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";

/** Settings → Notebook: whether code blocks may run, the limits, and for each language where it runs (Docker by default). */
export default async function NotebookSettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  await connection();
  if (!isInstalled("notebook")) return <PluginNotInstalled id="notebook" />;
  const sp = await searchParams;
  const languages = await languageStatuses(true);
  const on = notebookEnabled();
  const dockerUp = languages.some((l) => l.docker);
  const grants = allGrants();
  const functions = declaredFunctions();
  const byPlugin = [...new Set(functions.map((f) => f.plugin))];
  const RESOURCE: Record<string, string> = { tables: t("the tables, calculations and results of the page"), metrics: t("the Kennzahlen"), outputs: t("the values widgets publish"), databases: t("the list of databases") };
  const resourceName = (key: string) =>
    key.startsWith("database:")
      ? `${t("read the rows of database")} #${key.slice(9)}`
      : key.startsWith("write:database:")
        ? `✏️ ${t("add and change rows of database")} #${key.slice(15)}`
        : key.startsWith("delete:database:")
          ? `✏️ ${t("move rows of database to the trash")} #${key.slice(16)}`
          : key.startsWith("meta:schema:")
            ? `🛠 ${t("change fields and views of database")} #${key.slice(12)}`
            : key.startsWith("meta:")
              ? `🛠 ${t("change Zeff's structure")}: ${key.slice(5)}`
              : key === "write:outputs"
            ? `✏️ ${t("publish values for widgets and Zeff")}`
            : RESOURCE[key] ? `${t("read")} ${RESOURCE[key]}` : key;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/settings" className="text-sm text-zinc-500 hover:underline">
        ← {t("Settings")}
      </Link>
      <h1 className="text-xl font-semibold">{t("Notebook")}</h1>
      <p className="text-sm text-zinc-500">{t("Code blocks in your pages run Python, Node.js or Rust. By default each session runs in a Docker container of its own: no passwords or keys of Zeff in it, limited memory, its own folder as /work. Without Docker (or when you choose so) it runs on this computer with your rights — code can then read and delete your files. Running is off until you turn it on.")}</p>
      {sp.ok && <p className="alert-ok">{sp.ok}</p>}
      <form action={saveNotebookSettingsAction} className="card space-y-4 p-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="enabled" defaultChecked={on} />
          <span className="font-medium">{t("Let code blocks run")}</span>
        </label>
        <div className="flex flex-wrap gap-4">
          <label className="block text-sm">
            <span className="font-medium">{t("Time limit for one cell (seconds)")}</span>
            <input name="timeout" type="number" min={5} max={3600} defaultValue={cellTimeoutSeconds()} className={`${field} mt-1 block w-28`} />
          </label>
          <label className="block text-sm">
            <span className="font-medium">{t("Memory of a container")}</span>
            <input name="memory" defaultValue={memoryLimit()} className={`${field} mt-1 block w-24`} placeholder="2g" />
          </label>
          <label className="flex items-end gap-2 pb-1 text-sm">
            <input type="checkbox" name="network" defaultChecked={networkAllowed()} />
            <span>{t("Containers may use the network")}</span>
          </label>
        </div>
        <fieldset className="space-y-2 rounded border border-zinc-200 p-3 dark:border-zinc-800">
          <legend className="px-1 text-xs font-semibold uppercase text-zinc-500">{t("Languages")}</legend>
          <p className="text-xs text-zinc-500">{dockerUp ? t("Docker is running.") : t("Docker is not running — languages that are installed on this computer run there.")}</p>
          {languages.length === 0 && <p className="text-sm text-zinc-500">{t("No language plugin is installed (Menu → Plugins: Notebook · Python, · Node.js, · Rust).")}</p>}
          {languages.map((l) => (
            <div key={l.id} className="grid grid-cols-[7rem_1fr] items-center gap-x-3 gap-y-1 text-sm">
              <span className="flex items-center gap-1.5 font-medium">
                <span aria-hidden>{l.where ? "✅" : "⚠️"}</span>
                {l.label}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <select name={`mode.${l.id}`} defaultValue={l.mode} className={field} aria-label={t("Where it runs")}>
                  <option value="auto">{t("Docker if there, else this computer")}</option>
                  <option value="docker">{t("Always Docker")}</option>
                  <option value="host">{t("This computer")}</option>
                </select>
                <input name={`image.${l.id}`} defaultValue={l.image} className={`${field} w-48 font-mono text-xs`} aria-label={t("Docker image")} />
              </span>
              <span />
              <span className="text-xs text-zinc-500">
                {l.where === "docker" ? t("Runs in Docker.") : l.where === "host" ? t("Runs on this computer.") : t("Cannot run: Docker is not running and it is not installed here.")} · {l.host.found ? `${t("On this computer")}: ${l.host.version ?? ""}` : t("Not on this computer")}
              </span>
            </div>
          ))}
          <p className="text-xs text-zinc-500">{t("The first run in Docker pulls the image (a minute). Each language is a plugin of its own: install or remove it under Menu → Plugins.")}</p>
        </fieldset>
        <div className="flex items-center gap-2">
          <button className="btn btn-primary btn-sm">{t("Save")}</button>
          <span className="text-xs text-zinc-500">{on ? t("Code may run.") : t("Code does not run.")}</span>
        </div>
      </form>
      <div className="card space-y-2 p-4">
        <h2 className="text-sm font-semibold">{t("What code may read of Zeff")}</h2>
        <p className="text-xs text-zinc-500">{t("Code reaches your tables, results, Kennzahlen, widget values and databases through zeff.table(…), zeff.metric(…) and so on — only after you allowed it. The first time a cell asks for something it may not read yet, it stops and asks you; if you allow it, it is kept here and the code goes on.")}</p>
        {grants.length === 0 ? (
          <p className="text-sm text-zinc-500">{t("Nothing is allowed yet.")}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {grants.map((g) => (
              <li key={`${g.scope}:${g.key}`} className="flex flex-wrap items-center gap-2">
                <span>{resourceName(g.key)}</span>
                <span className="text-zinc-500">· {g.scope === "*" ? t("every page") : g.scope.startsWith("fn:") ? `${t("functions of the plugin")} ${g.scope.slice(3)}` : `${t("page")} #${g.scope}`}</span>
                <form action={revokeGrantAction} className="ml-auto">
                  <input type="hidden" name="scope" value={g.scope} />
                  <input type="hidden" name="key" value={g.key} />
                  <button className="btn btn-sm">{t("Take back")}</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>
      {byPlugin.length > 0 && (
        <div className="card space-y-2 p-4">
          <h2 className="text-sm font-semibold">{t("Functions of plugins")}</h2>
          <p className="text-xs text-zinc-500">{t("Plugins can bring server functions (Python or Node.js) that run here, in a container. There is nobody to ask when one runs: what it reads or changes of Zeff is only what you allow it here.")}</p>
          <ul className="space-y-2 text-sm">
            {byPlugin.map((id) => {
              const mine = functions.filter((f) => f.plugin === id);
              const needs = [...new Set(mine.flatMap((f) => f.needs))];
              const allowed = needs.length === 0 || needsGranted(id, needs);
              return (
                <li key={id} className="space-y-1 rounded border border-zinc-200 p-2 dark:border-zinc-800">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{id}</span>
                    <span className="text-zinc-500">{mine.map((f) => f.name).join(", ")}</span>
                    {!allowed && (
                      <form action={grantFunctionAction} className="ml-auto">
                        <input type="hidden" name="plugin" value={id} />
                        <button className="btn btn-sm">{t("Allow what they need")}</button>
                      </form>
                    )}
                    {allowed && needs.length > 0 && <span className="ml-auto text-xs text-emerald-700 dark:text-emerald-300">{t("Allowed")}</span>}
                  </div>
                  {needs.length > 0 ? <p className="text-xs text-zinc-500">{t("They ask for:")} {needs.join(", ")}</p> : <p className="text-xs text-zinc-500">{t("They need nothing of Zeff's data.")}</p>}
                  {mine.some((f) => f.webhook) && (
                    <div className="space-y-1 border-t border-zinc-200 pt-1 text-xs dark:border-zinc-800">
                      <p className="text-zinc-500">
                        {t("Webhooks (programs outside Zeff may call them):")} {mine.filter((f) => f.webhook).map((f) => `POST /api/ext/hook/${id}/${f.name}`).join(", ")}
                      </p>
                      {webhookSecret(id) ? (
                        <p>
                          {t("Secret (send it as “Authorization: Bearer …”):")} <code className="select-all break-all">{webhookSecret(id)}</code>
                        </p>
                      ) : (
                        <p className="text-zinc-500">{t("Switched off: without a secret nobody can call them.")}</p>
                      )}
                      <form action={webhookSecretAction} className="flex gap-2">
                        <input type="hidden" name="plugin" value={id} />
                        <button className="btn btn-sm">{webhookSecret(id) ? t("Make a new secret") : t("Switch webhooks on")}</button>
                        {webhookSecret(id) && (
                          <button className="btn btn-sm" name="off" value="1">
                            {t("Switch off")}
                          </button>
                        )}
                      </form>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
