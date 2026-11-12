import Link from "next/link";
import { t } from "@/lib/i18n/server";
import { checkRequirements, getInstalled, packageIdOf, packagePermissions, packageStatus } from "../package-life";
import { listPackages } from "../packages";
import { installPackageFormAction, rollbackPackageFormAction, testPackageFormAction, updatePackageFormAction } from "../actions/package-forms";

/** Workspace settings → Packages: the apps installed (version, update, roll back, tests, history) and the ones on offer with what they ask for. */
export async function PackagesView({ ok }: { ok?: string }) {
  const installed = await packageStatus();
  const have = new Set(installed.map((p) => p.id));
  const offers = listPackages().filter((o) => !(o.pkg.version && have.has(packageIdOf(o.pkg))));
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{t("Packages")}</h2>
      <p className="text-sm text-zinc-500">{t("Apps made of pages, databases, flows and widgets. An installed package with a version can be updated in place: what you changed stays, what it adds is added, its data is migrated, and every step is in the history.")}</p>
      {ok && <p className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">{ok}</p>}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t("Installed")}</h3>
        {installed.length === 0 && <p className="text-sm text-zinc-500">{t("Nothing installed yet.")}</p>}
        <ul className="space-y-2">
          {installed.map((p) => {
            const full = getInstalled(p.id);
            return (
              <li key={p.id} className="card space-y-2 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/workspace/${p.rootId}`} className="font-medium hover:underline">
                    {p.name}
                  </Link>
                  <span className="text-zinc-500">{p.version}</span>
                  {p.updateAvailable && <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">{t("Update on offer: {v}", { v: p.offered ?? "" })}</span>}
                  <span className="ml-auto text-xs text-zinc-500">{p.lastChange}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {p.updateAvailable && (
                    <>
                      <form action={updatePackageFormAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <button className="btn btn-sm btn-primary">{t("Update")}</button>
                      </form>
                      <form action={updatePackageFormAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="force" value="1" />
                        <button className="btn btn-sm" title={t("The package's version replaces yours where you changed it")}>
                          {t("Update, replacing my changes")}
                        </button>
                      </form>
                    </>
                  )}
                  <form action={testPackageFormAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <button className="btn btn-sm">{t("Run tests")}</button>
                  </form>
                  {p.versionsKept
                    .filter((v) => v !== p.version)
                    .map((v) => (
                      <form key={v} action={rollbackPackageFormAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="version" value={v} />
                        <button className="btn btn-sm" title={t("Bring this version's structure back")}>
                          ↶ {v}
                        </button>
                      </form>
                    ))}
                </div>
                {full && (
                  <details className="text-xs text-zinc-600 dark:text-zinc-400">
                    <summary className="cursor-pointer">{t("History")}</summary>
                    <ul className="mt-1 space-y-0.5">
                      {[...full.history].reverse().map((h) => (
                        <li key={h.at}>
                          {h.at.slice(0, 16).replace("T", " ")} · {h.action} {h.from ?? "—"} → {h.to}: {h.changes.join("; ")}
                          {h.tests ? ` [${h.tests.filter((x) => x.ok).length}/${h.tests.length}]` : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t("On offer")}</h3>
        {offers.length === 0 && <p className="text-sm text-zinc-500">{t("No plugin offers a package right now.")}</p>}
        <ul className="space-y-2">
          {offers.map((o) => {
            const perms = packagePermissions(o.pkg);
            const problems = checkRequirements(o.pkg);
            const asks = [...perms.flows, ...perms.routines, ...perms.widgets];
            return (
              <li key={o.id} className="card space-y-1 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span aria-hidden>{o.icon}</span>
                  <span className="font-medium">{o.name}</span>
                  {o.pkg.version && <span className="text-zinc-500">{o.pkg.version}</span>}
                  <div className="ml-auto flex gap-2">
                    <form action={installPackageFormAction}>
                      <input type="hidden" name="key" value={o.id} />
                      <button className="btn btn-sm" disabled={problems.length > 0}>
                        {t("Install")}
                      </button>
                    </form>
                    {perms.flows.length > 0 && (
                      <form action={installPackageFormAction}>
                        <input type="hidden" name="key" value={o.id} />
                        <input type="hidden" name="allow" value="1" />
                        <button className="btn btn-sm btn-primary" disabled={problems.length > 0} title={t("Its flows get the permissions they ask for (listed under “What it asks for”)")}>
                          {t("Install and allow what it asks")}
                        </button>
                      </form>
                    )}
                  </div>
                </div>
                {o.description && <p className="text-xs text-zinc-500">{o.description}</p>}
                {problems.length > 0 && <p className="text-xs text-red-700 dark:text-red-300">{problems.join(" ")}</p>}
                {(asks.length > 0 || perms.plugins.length > 0 || perms.requires.length > 0) && (
                  <details className="text-xs text-zinc-600 dark:text-zinc-400">
                    <summary className="cursor-pointer">{t("What it asks for")}</summary>
                    <ul className="mt-1 list-disc pl-4">
                      {perms.plugins.length > 0 && (
                        <li>
                          {t("Plugins")}: {perms.plugins.join(", ")}
                        </li>
                      )}
                      {perms.requires.length > 0 && (
                        <li>
                          {t("Other packages")}: {perms.requires.join(", ")}
                        </li>
                      )}
                      {asks.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
