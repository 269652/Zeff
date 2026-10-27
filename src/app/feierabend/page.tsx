import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { rich } from "@/lib/i18n/rich";
import Link from "next/link";
import { connection } from "next/server";
import { FeierabendForm } from "@/components/FeierabendForm";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { proposeDay, proposeWeek } from "@/lib/feierabend";
import { formatLongDay } from "@/lib/format";
import { isInstalled } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("End of day") };
}

/**
 * Feierabend: the day drafted for booking — today's finished meetings not booked yet, the agents'
 * suggestions, the tickets you worked on (todos done, worker runs, with their time) — to check
 * and book in one go. Nothing is booked before you click.
 */
export default async function FeierabendPage({ searchParams }: { searchParams: Promise<{ date?: string; week?: string }> }) {
  await connection();
  if (!isInstalled("zeiterfassung")) return <PluginNotInstalled id="zeiterfassung" />;
  const sp = await searchParams;
  // The whole week at once (Friday: Monday to today, each day its own lines and its own "book"), with the evidence of each line.
  if (sp.week) {
    const w = await proposeWeek(sp.week === "current" ? null : sp.week);
    return (
      <div className="page">
        <div className="page-aside">
          <h1 className="text-lg font-semibold">{t("The week to book")}</h1>
          <p className="text-sm text-zinc-500">
            {t("{week} — each day as a booking suggestion: its meetings, the agents' suggestions, the tickets you worked on (todos done, worker runs, your commits — an estimate from their span where no time was taken, said so). Check each day, book it with its button — nothing is booked before.", { week: w.key })}
          </p>
          <p className="text-xs text-zinc-400">{t("Then the week goes to Chrono/Punch from the Weekly report — your click, as always.")}</p>
        </div>
        <div className="space-y-8">
          {w.days.map((p) => (
            <section key={p.date} className="space-y-2">
              <h2 className="text-sm font-semibold">
                {formatLongDay(p.date)} <span className="font-normal text-zinc-500">· {t("{booked} of {target} h booked", { booked: p.booked, target: p.target })}</span>
              </h2>
              {p.rows.length ? <FeierabendForm date={p.date} target={p.target} booked={p.booked} group={p.group} rows={p.rows} jobs={p.jobs} /> : <p className="text-sm text-zinc-400">{t("Nothing to propose for this day.")}</p>}
            </section>
          ))}
        </div>
      </div>
    );
  }
  const p = await proposeDay(sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date < new Date().toISOString().slice(0, 10) ? new Date(`${sp.date}T23:59:00`) : new Date());
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("End of day")}</h1>
        <p className="text-sm text-zinc-500">
          {t(
            "{day} — the day as a booking suggestion: today's meetings, the agents' suggestions and the tickets you worked on (todos done, worker runs with their time). Check, adjust, book with one click — nothing is booked before.",
            { day: formatLongDay(p.date) },
          )}
        </p>
        <p className="text-sm">
          <Link href="/feierabend?week=current" className="text-indigo-600 hover:underline dark:text-indigo-400">
            {t("The whole week →")}
          </Link>
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
      <FeierabendForm date={p.date} target={p.target} booked={p.booked} group={p.group} rows={p.rows} jobs={p.jobs} />
    </div>
  );
}
