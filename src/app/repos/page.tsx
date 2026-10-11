import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";
import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { rich } from "@/lib/i18n/rich";
import Link from "next/link";
import { connection } from "next/server";
import { GitMissingNotice } from "@/components/GitMissingNotice";
import { RepoForm } from "@/components/RepoForm";
import { listRepos, repoChoices } from "@/lib/repos";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Repos") };
}

/**
 * Repos: where workers implement — each repo's folder here and GitLab project, and the Jira
 * boards (and single tickets) whose work goes there. A ticket's work goes to the repo that names
 * it, else its board's, else the one its merge requests are in.
 */
export default async function ReposPage() {
  await connection();
  // A plugin's page: there while it's installed.
  if (!isInstalled("work")) return <PluginNotInstalled id="work" />;
  const repos = listRepos();
  const choices = repoChoices();
  const boardName = new Map(choices.boards.map((b) => [b.id, b.name]));
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("Repos")}</h1>
        <p className="max-w-[75ch] text-sm text-zinc-500">
          {rich(
            t(
              "Where the <link>Work</link> tab's workers implement. A ticket's work goes to the repo that names the ticket, else to the one its Jira board is assigned to, else to the one whose GitLab project its merge requests are in. The projects come from the GitLab sync, the boards from the Jira tab.",
            ),
            {
              link: (s) => (
                <Link href="/work" className="text-indigo-600 hover:underline dark:text-indigo-400">
                  {s}
                </Link>
              ),
            },
          )}
        </p>
      </div>

      <GitMissingNotice />
      {repos.map((r) => (
        <section key={r.id} className="card space-y-3 p-4">
          <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="font-semibold">{r.name}</h2>
            <span className={`text-xs ${r.ok ? "text-zinc-500" : "text-red-600 dark:text-red-400"}`}>{r.ok ? t("on {branch}", { branch: r.branch }) : t("folder missing")}</span>
            <span className="text-xs text-zinc-500">
              {r.boards.length ? r.boards.map((b) => boardName.get(b) ?? t("board {id}", { id: b })).join(", ") : t("no boards")}
              {r.tickets.length ? ` · ${r.tickets.join(", ")}` : ""}
            </span>
          </header>
          <RepoForm repo={r} choices={choices} />
        </section>
      ))}

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{repos.length ? t("Add another repo") : t("Add a repo")}</h2>
        {!choices.projects.length && <p className="text-sm text-zinc-500">{t("No GitLab projects synced yet — the GitLab tab syncs them; the folder works without one too.")}</p>}
        <RepoForm key={repos.length} choices={choices} />
      </section>
    </div>
  );
}
