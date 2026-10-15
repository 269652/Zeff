import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { BetaWarning } from "@/components/BetaBadge";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { AdminSessionsForm } from "@/components/work/AdminSessionsForm";
import { t } from "@/lib/i18n/server";
import { rich } from "@/lib/i18n/rich";
import { PLUGINS } from "@/plugins/catalog";
import { isInstalled } from "@/plugins/state";
import { elevationMode, taskInstalled, zeffElevated } from "@/plugins/work-elevated/elevate";

export const metadata: Metadata = { title: "Admin sessions" };

/**
 * Admin sessions (beta plugin): Claude sessions on the Code tab run as administrator — Windows
 * asks each time (UAC), or a scheduled task set up once starts them without asking.
 */
export default async function AdminSessionsPage() {
  await connection();
  if (!isInstalled("work-elevated")) return <PluginNotInstalled id="work-elevated" />;
  const beta = PLUGINS.find((p) => p.id === "work-elevated")?.beta ?? "";
  const windows = process.platform === "win32";
  const [task, elevated] = windows ? await Promise.all([taskInstalled(), zeffElevated()]) : [false, false];
  const mode = elevationMode();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold">{t("Admin sessions")}</h1>
        <p className="text-sm text-zinc-500">
          {rich(t("Live Claude sessions as administrator: tick “As administrator” when you start one on the <link>Code tab</link>."), {
            link: (s) => (
              <Link href="/work" className="text-indigo-600 hover:underline dark:text-indigo-400">
                {s}
              </Link>
            ),
          })}{" "}
          {t("Everything else stays as in any session — its mode decides what it asks you.")}
        </p>
      </header>
      <BetaWarning warning={beta} />
      {!windows ? (
        <p className="card p-4 text-sm">{t("Admin sessions are for Windows. Elsewhere, start Zeff itself with the rights its sessions need.")}</p>
      ) : (
        <section className="card space-y-3 p-4 text-sm">
          {elevated && <p className="rounded bg-amber-50 p-2 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">{t("Zeff itself runs as administrator — so does every session, ticked or not.")}</p>}
          <dl className="grid grid-cols-[12rem_1fr] gap-y-1">
            <dt className="text-zinc-500">{t("How they start")}</dt>
            <dd className="font-medium">{mode === "task" && task ? t("Automatically — the scheduled task, no prompt") : t("Interactively — Windows asks you (UAC) each time")}</dd>
            <dt className="text-zinc-500">{t("Scheduled task")}</dt>
            <dd>{task ? t("set up (\\Zeff\\Elevated work sessions)") : t("not set up")}</dd>
          </dl>
          <AdminSessionsForm task={task} />
        </section>
      )}
    </div>
  );
}
