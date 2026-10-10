import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { FeierabendForm } from "@/components/FeierabendForm";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { proposeDay } from "@/lib/feierabend";
import { isInstalled } from "@/plugins/state";

export const metadata: Metadata = { title: "Feierabend" };

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
        <h1 className="text-lg font-semibold">Feierabend</h1>
        <p className="text-sm text-zinc-500">
          {new Date(`${p.date}T12:00:00`).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })} — der Tag als Buchungsvorschlag: deine heutigen Termine, die
          Vorschläge der Agenten und die Tickets, an denen du gearbeitet hast (erledigte Todos, Worker-Läufe mit ihrer Zeit). Prüfen, anpassen, mit einem Klick buchen — vorher wird nichts gebucht.
        </p>
        <p className="text-xs text-zinc-400">
          Gebucht wird wie von Hand; danach steht alles im{" "}
          <Link href="/" className="text-indigo-600 hover:underline dark:text-indigo-400">
            Wochenbericht
          </Link>{" "}
          (und geht von dort nach Roar/TimO, wenn du exportierst).
        </p>
      </div>
      <FeierabendForm date={p.date} target={p.target} booked={p.booked} rows={p.rows} jobs={p.jobs} />
    </div>
  );
}
