import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { rich } from "@/lib/i18n/rich";
import Link from "next/link";
import { connection } from "next/server";
import { FeierabendForm } from "@/components/FeierabendForm";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { proposeDay } from "@/lib/feierabend";
import { currentLocale } from "@/lib/format";
import { isInstalled } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("End of day") };
}

/**
 * Feierabend: the day drafted for booking — today's finished meetings not booked yet, the agents'
 * suggestions, the tickets you worked on (todos done, worker runs, with their time) — to check
 * and book in one go. Nothing is booked before you click.
 */
export default async function FeierabendPage() {
  await connection();
  if (!isInstalled("zeiterfassung")) return <PluginNotInstalled id="zeiterfassung" />;
  const p = await proposeDay();
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("End of day")}</h1>
        <p className="text-sm text-zinc-500">
          {t(
            "{day} — the day as a booking suggestion: today's meetings, the agents' suggestions and the tickets you worked on (todos done, worker runs with their time). Check, adjust, book with one click — nothing is booked before.",
            { day: new Date(`${p.date}T12:00:00`).toLocaleDateString(currentLocale(), { weekday: "long", day: "numeric", month: "long" }) },
          )}
        </p>
        <p className="text-xs text-zinc-400">
          {rich(t("It's booked just like by hand; then everything is in the <link>Weekly report</link> (and goes from there to Chrono/Punch when you export)."), {
            link: (s) => (
              <Link href="/" className="text-indigo-600 hover:underline dark:text-indigo-400">
                {s}
              </Link>
            ),
          })}
        </p>
      </div>
      <FeierabendForm date={p.date} target={p.target} booked={p.booked} rows={p.rows} jobs={p.jobs} />
    </div>
  );
}
