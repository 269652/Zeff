import Link from "next/link";
import { hookLog } from "@/lib/ext/hooks";
import { allEvents } from "@/lib/plugins/api-point";
import { permissionTexts } from "@/lib/ext/permission-texts";
import { allPlugins, pluginsRoot, scanPlugins } from "@/lib/ext/registry";
import { t } from "@/lib/i18n/server";
import { ExtToggle } from "./ExtToggle";

/**
 * The Plugins page's section for external plugins (src/lib/ext): the folders in the plugins folder
 * — each on or off, what it may do and what it brings — and what's wrong with the ones that don't load.
 */
export function ExternalPlugins() {
  const plugins = allPlugins();
  const words = permissionTexts();
  const permissionText = (id: string) => words[id] ?? t("(no installed plugin offers this)");
  const { problems } = scanPlugins();
  const root = pluginsRoot();
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("External plugins")}</h2>
        <Link href="/ext/docs" className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
          {t("How to write one →")}
        </Link>
      </div>
      <p className="max-w-[75ch] text-sm text-zinc-500">
        {t("Plugins you add without changing Zeff: put a folder with a zeff-plugin.json into the plugins folder — it shows up here at once, no restart. They can add rules for Work's workers, “/” commands, views, MCP servers and event hooks.")}{" "}
        <code className="rounded bg-zinc-100 px-1 text-xs dark:bg-zinc-800">{root}</code>
      </p>
      {plugins.length === 0 && problems.length === 0 && <p className="card p-4 text-sm text-zinc-500">{t("No external plugins yet. docs/plugins/ has the reference and examples/plugins/ two plugins to start from.")}</p>}
      <ul className="grid gap-3 md:grid-cols-2">
        {plugins.map((p) => {
          const c = p.manifest.contributes;
          const bits = [
            c.workerRules.length ? t("{n} rule file(s)", { n: c.workerRules.length }) : null,
            c.workCommands.length ? t("{n} command(s)", { n: c.workCommands.length }) : null,
            c.workPanels.length ? t("{n} view(s)", { n: c.workPanels.length }) : null,
            Object.keys(c.workerMcpServers).length ? t("{n} MCP server(s)", { n: Object.keys(c.workerMcpServers).length }) : null,
            Object.keys(c.hooks).length ? t("hooks: {events}", { events: Object.keys(c.hooks).join(", ") }) : null,
          ].filter(Boolean);
          const runs = p.enabled ? hookLog(p.id).slice(0, 3) : [];
          return (
            <li key={p.id} className={`card space-y-2 p-4 ${p.enabled ? "" : "opacity-80"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-medium">
                    {p.manifest.name} <span className="text-xs font-normal text-zinc-400">{p.manifest.version}</span>{" "}
                    {p.enabled ? (
                      <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{t("on")}</span>
                    ) : (
                      <span className="ml-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{t("off")}</span>
                    )}
                  </h3>
                  <p className="font-mono text-[11px] text-zinc-400">
                    {p.id}
                    {p.manifest.author ? ` · ${p.manifest.author}` : ""}
                  </p>
                  {p.manifest.description && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{p.manifest.description}</p>}
                </div>
                <ExtToggle id={p.id} name={p.manifest.name} enabled={p.enabled} permissions={p.manifest.permissions.map(permissionText)} />
              </div>
              {bits.length > 0 && <p className="text-xs text-zinc-500">{bits.join(" · ")}</p>}
              {p.manifest.permissions.length > 0 && (
                <ul className="space-y-0.5 text-xs text-zinc-500">
                  {p.manifest.permissions.map((x) => (
                    <li key={x} className={x === "exec" ? "text-amber-700 dark:text-amber-400" : ""}>
                      <span className="font-mono">{x}</span> — {permissionText(x)}
                      {p.ungranted.includes(x) && <span className="font-medium text-red-600 dark:text-red-400"> · {t("added by an update — turn off and on again to grant it")}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {runs.length > 0 && (
                <ul className="space-y-0.5 border-t border-zinc-100 pt-2 text-xs dark:border-zinc-800">
                  {runs.map((r, i) => (
                    <li key={i} className={r.ok ? "text-zinc-500" : "text-red-600 dark:text-red-400"} title={r.output}>
                      {r.ok ? "✓" : "✗"} {r.event} · {r.ms} ms{r.ok ? "" : ` · ${r.output.split("\n")[0].slice(0, 80)}`}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
        {problems.map((p) => (
          <li key={p.dir} className="card space-y-1 border-red-200 p-4 dark:border-red-900">
            <h3 className="font-mono text-sm font-medium">{p.dir}</h3>
            <p className="text-xs text-red-700 dark:text-red-300">{t("Not loaded: {error}", { error: p.error })}</p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-zinc-400">{t("Events hooks can listen to: {events}", { events: allEvents().map((e) => e.id).join(", ") })}</p>
    </section>
  );
}
