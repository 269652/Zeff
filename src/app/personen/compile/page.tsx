import { EmptyState } from "@/components/EmptyState";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { SubmitButton } from "@/components/SubmitButton";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { compileProgress } from "@/plugins/people/compile";
import { CompileProgress } from "@/plugins/people/CompileProgress";
import { PersonSummaryDetails } from "@/plugins/people/SummaryView";
import { compileAllFormAction, compileOneFormAction } from "@/plugins/people/server-actions";
import { listPeople } from "@/plugins/people/store";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Compile — People") };
}

/**
 * Compile (the People plugin): a summary of each person from everything Zeff has on them — what
 * connects you, the key facts, the fun facts — written by the AI, kept on the profile.
 */
export default async function CompilePage({ searchParams }: { searchParams: Promise<{ started?: string; busy?: string; error?: string }> }) {
  await connection();
  if (!isInstalled("people")) return <PluginNotInstalled id="people" />;
  const sp = await searchParams;
  const people = listPeople();
  const progress = compileProgress();
  const running = !!progress && !progress.result;
  const compiled = people.filter((p) => p.compiled);

  return (
    <div className="page">
      <div className="page-aside">
        <Link href="/personen" className="text-sm text-zinc-500 hover:underline">
          ← {t("People")}
        </Link>
        <h1 className="text-lg font-semibold">{t("Compile")}</h1>
        <p className="text-sm text-zinc-500">
          {t("A summary of every person from everything Zeff has on them — their messages, mails, Teams, Jira, your todos, the facts it kept: what connects you, the key facts, the fun facts. Nothing is invented; someone Zeff knows nothing about isn't asked about.")}
        </p>
        {running && progress ? (
          <CompileProgress done={progress.done} total={progress.total} current={progress.current} />
        ) : (
          <div className="space-y-2">
            <form action={compileAllFormAction}>
              <SubmitButton className="btn btn-primary btn-sm w-full" pendingText={t("Starting …")}>
                {t("Compile everyone (AI)")}
              </SubmitButton>
            </form>
            <form action={compileAllFormAction}>
              <input type="hidden" name="force" value="1" />
              <button className="btn btn-sm w-full" title={t("Also those compiled in the last 12 hours")}>
                {t("Compile everyone again")}
              </button>
            </form>
          </div>
        )}
        {sp.error && <p className="alert-error text-sm">{sp.error}</p>}
        {sp.started && !running && <p className="alert-ok text-sm">{t("Started — the summaries appear as they are done.")}</p>}
        {sp.busy && <p className="text-sm text-amber-700 dark:text-amber-400">{t("A compile run is going already.")}</p>}
        {progress?.result && (
          <p className={`text-sm ${progress.result.failed.length ? "text-amber-700 dark:text-amber-400" : "text-zinc-500"}`}>
            {t("Last run: {c} compiled, {s} left as they were", { c: progress.result.compiled, s: progress.result.skipped })}
            {progress.result.failed.length > 0 && ` · ${t("{n} failed: {names}", { n: progress.result.failed.length, names: progress.result.failed.join("; ").slice(0, 400) })}`}
          </p>
        )}
        <p className="text-xs text-zinc-400">{t("{n} of {total} people have a summary.", { n: compiled.length, total: people.length })}</p>
      </div>

      <div className="space-y-3">
        {people.length === 0 && <EmptyState>{t("Nobody yet — add or import people on the People page first.")}</EmptyState>}
        <ul className="grid gap-3 xl:grid-cols-2">
          {people.map((p) => (
            <li key={p.id} className="card space-y-2 p-4 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <Link href={`/personen/${p.id}`} className="font-semibold hover:underline">
                  {p.name}
                </Link>
                <form action={compileOneFormAction}>
                  <input type="hidden" name="id" value={p.id} />
                  <button className="btn btn-sm" disabled={running} title={t("Compile just this person (again)")}>
                    {p.compiled ? t("Compile again") : t("Compile")}
                  </button>
                </form>
              </div>
              {p.compiled ? (
                <PersonSummaryDetails summary={p.compiled} />
              ) : (
                <p className="text-zinc-400">{t("Not compiled yet.")}</p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
