import { t } from "@/lib/i18n/server";
import { neededPrerequisites } from "@/lib/prerequisites";

/**
 * "This PC": the programs the installed plugins use that Zeff doesn't bring along (the automation
 * browser, git, uv, the AI CLIs, Poppler) — found or missing, with the one-line way to get a missing one.
 * Only what the installed plugins need. Server component.
 */
export function ThisPc() {
  const rows = neededPrerequisites();
  if (!rows.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("This PC")}</h2>
      <p className="max-w-[75ch] text-xs text-zinc-500">{t("Zeff brings its own Node and servers; these programs it uses come from your PC. Installed one just now? Restart Zeff so it finds it.")}</p>
      <ul className="card divide-y divide-zinc-100 dark:divide-zinc-800">
        {rows.map((r) => (
          <li key={r.id} className="flex items-start gap-3 px-4 py-2 text-sm">
            <span className={`w-4 shrink-0 text-center font-semibold ${r.found ? "text-emerald-600" : "text-red-500"}`} title={r.found ? t("found") : t("not found")}>
              {r.found ? "✓" : "✗"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {r.label} <span className="text-xs font-normal text-zinc-500">{r.neededFor}</span>
              </div>
              {r.found ? <p className="truncate text-xs text-zinc-400" title={r.found}>{r.found}</p> : <p className="text-xs text-red-600 dark:text-red-400">{r.howToGet}</p>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
