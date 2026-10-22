import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { dataDir } from "@/db";
import { PLUGINS } from "@/plugins/catalog";
import { catalogText } from "@/plugins/catalog-text";
import { installedPlugins } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("What leaves this PC") };
}

/**
 * What stays here and what goes where: Zeff keeps everything on this PC; the plugins you installed talk to
 * their services, and the AI steps send the text they read to the AI you chose. Built from the installed
 * plugins, so it says only what is true for this Zeff.
 */
export default async function PrivacyPage() {
  await connection();
  const on = installedPlugins();
  const connectors = PLUGINS.filter((p) => on.has(p.id) && p.category === "connector" && p.id !== "backup");
  const ai = PLUGINS.filter((p) => on.has(p.id) && p.aiProvider);
  return (
    <div className="page">
      <div className="page-aside">
        <Link href="/settings" className="text-sm text-zinc-500 hover:underline">
          ← {t("Settings")}
        </Link>
        <h1 className="text-lg font-semibold">{t("What leaves this PC")}</h1>
        <p className="text-sm text-zinc-500">{t("Zeff runs on your PC and has no account, no cloud and no usage tracking of its own. This is what is kept here, and what goes where because of the plugins you installed.")}</p>
        <Link href="/diagnostics" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          {t("Diagnostics")}
        </Link>
      </div>

      <div className="space-y-4">
        <section className="card space-y-2 p-4 text-sm">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Stays on this PC")}</h2>
          <p>{t("Everything Zeff reads and makes — mails, chats, tickets, todos, notes, the summaries — lives in a database in {dir}. Sign-ins are kept in the automation browser's profile on this PC; Zeff never types or stores your passwords for them.", { dir: dataDir() })}</p>
          <p className="text-zinc-500">{t("Backups are encrypted with your password and stay where you put them (Menu → Backups).")}</p>
        </section>

        <section className="card space-y-2 p-4 text-sm">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Goes to the AI you chose")}</h2>
          <p>
            {t("The AI steps (the briefing, the mail and chat reviews, people summaries, questions) send the text they work on — parts of mails, chats, tickets and notes — to the AI program you signed in to. That is your own account with them, under their terms:")}
          </p>
          <ul className="list-disc pl-5">
            {ai.length ? ai.map((p) => <li key={p.id}>{catalogText(t, p.name)}</li>) : <li className="list-none text-zinc-500">{t("No AI program is installed — nothing is sent.")}</li>}
          </ul>
          <p className="text-zinc-500">
            {t("Don't want a source read by the AI? Mark it secret under Data boundaries — or uninstall its plugin under Menu → Plugins.")}{" "}
            <Link href="/privacy/boundaries" className="text-indigo-600 hover:underline dark:text-indigo-400">
              🔒 {t("Data boundaries")}
            </Link>
          </p>
        </section>

        <section className="card space-y-2 p-4 text-sm">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Talks to your services")}</h2>
          <p>{t("Each connector reads from its own service, signed in as you, and writes only what you trigger (a booking, a comment, a transition):")}</p>
          <ul className="list-disc pl-5">
            {connectors.map((p) => (
              <li key={p.id}>{catalogText(t, p.name)}</li>
            ))}
          </ul>
        </section>

        <section className="card space-y-2 p-4 text-sm">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Downloads while installing")}</h2>
          <p className="text-zinc-500">{t("The setup's install buttons download programs from their makers (Google, Git, Anthropic, GitHub, OpenAI, Node.js, Astral) — nothing of yours is sent with that.")}</p>
        </section>
      </div>
    </div>
  );
}
