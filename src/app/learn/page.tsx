import type { Metadata } from "next";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { redirect } from "@/lib/redirect";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { learnStatus } from "@/plugins/learn/setup";
import { setupLearnAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Learn") };
}

/**
 * Learn: when it is set up, its Courses (the Learn app of the package) open; the first time, a page says what will be set up and does it on
 * one click. Learn itself is built with Zeff — a package of Workspace databases, an app view, flows and server functions.
 */
export default async function LearnPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await connection();
  if (!isInstalled("learn")) return <PluginNotInstalled id="learn" />;
  const sp = await searchParams;
  const s = await learnStatus();
  if (s.ready && s.coursesId && !sp.ok && !sp.err) return redirect(`/workspace/${s.coursesId}`);
  const todo = [
    !s.notebookPlugin && t("install the Notebook plugin (it runs Learn's server functions)"),
    !s.codeRuns && t("switch on running code (Settings → Notebook) — in a container if Docker is there"),
    !s.pluginOn && t("switch on the plugin “Learn (external)”"),
    !s.packageVersion && t("install Learn's package: courses, steps, cards, conversations and the Learn app"),
    s.updateAvailable && t("bring the package to its newest version"),
    t("allow Learn's flows and functions what they ask for (its databases, the AI, your calendar and todos)"),
    s.legacyToImport && t("bring over your courses, steps, cards and conversations from the old Learn (the old databases stay as they are)"),
  ].filter((x): x is string => !!x);
  return (
    <div className="mx-auto max-w-2xl space-y-4 py-6">
      <h1 className="text-xl font-semibold">🎓 {t("Learn")}</h1>
      {sp.ok && <p className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">{sp.ok}</p>}
      {sp.err && <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">{sp.err}</p>}
      <p className="text-sm text-zinc-600 dark:text-zinc-300">{t("Learn is built with Zeff itself: its courses, steps, cards and conversations are Workspace databases, its screens a view, its logic flows and server functions. Before you start, this is set up:")}</p>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {todo.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
      <form action={setupLearnAction}>
        <button className="btn btn-primary">{t("Set up Learn")}</button>
      </form>
      <p className="text-xs text-zinc-500">{t("Nothing leaves your computer except what the AI is asked. You can undo each part in Settings → Notebook, Menu → Plugins and Workspace settings → Packages.")}</p>
    </div>
  );
}
