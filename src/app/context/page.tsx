import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { connection } from "next/server";
import { createContextAction } from "@/app/actions";
import { ContextCard, SourceList } from "@/components/ContextCard";
import { ContextForm } from "@/components/ContextForm";
import { ContextFormOptionsProvider } from "@/components/ContextFormOptions";
import { ContextSyncButton } from "@/components/ContextSyncButton";
import { resolveLinks } from "@/lib/context-links";
import { listContextPeople, listContexts } from "@/lib/contexts";
import { itemSource, jiraSyncState } from "@/lib/contexts-shared";
import { getTicketCards } from "@/lib/jira/store";
import { getEntryTicketSuggestions } from "@/lib/ticket-suggestions";
import { currentWeek, todayIso } from "@/lib/week";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Context") };
}

export default async function ContextPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await connection();
  const q = (await searchParams).q?.trim() ?? "";
  const items = listContexts({ q, limit: 300 });
  const toSync = items.filter((c) => ["unsynced", "changed"].includes(jiraSyncState(c)));
  const tickets = getTicketCards(items.map((c) => c.ticket));
  // A synced Teams message or GitLab item of its own is a badge row; notes are cards.
  const entities = resolveLinks(items.flatMap((c) => c.links.map((l) => l.url)));
  const sources = items.filter((c) => itemSource(c, entities));
  const notes = items.filter((c) => !itemSource(c, entities));
  const people = listContextPeople();

  return (
    <ContextFormOptionsProvider value={{ people, tickets: getEntryTicketSuggestions(currentWeek()) }}>
      <div className="page">
        <div className="page-aside">
          <div>
            <h1 className="text-lg font-semibold">{t("Context")}</h1>
            <p className="text-sm text-zinc-500">
              {t("What colleagues wrote about your work — Teams messages, merge requests, comments and notes. Each item can back several entries and goes to its Jira ticket as a comment.")}
            </p>
          </div>
          <form action="/context" className="flex gap-2">
            <input name="q" defaultValue={q} placeholder={t("Search who, what, ticket…")} className="input w-64" aria-label={t("Search context")} />
            <button type="submit" className="btn">
              {t("Search")}
            </button>
          </form>
        </div>

        <details className="card p-4" open={items.length === 0 && !q}>
          <summary className="cursor-pointer text-sm font-semibold text-zinc-500 uppercase">{t("+ Add context")}</summary>
          <div className="mt-3">
            <ContextForm action={createContextAction.bind(null, null)} defaults={{ date: todayIso() }} />
          </div>
        </details>

        {toSync.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/40">
            <span>
              {toSync.length === 1
                ? t("1 item isn't on its Jira ticket yet (or changed since).")
                : t("{n} items aren't on their Jira tickets yet (or changed since).", { n: toSync.length })}
            </span>
            <ContextSyncButton ids={toSync.map((c) => c.id)} tickets={toSync.map((c) => c.ticket!)} label={t("Sync {n} to Jira", { n: toSync.length })} />
          </div>
        )}

        {items.length === 0 ? (
          <p className="card p-6 text-center text-sm text-zinc-500">{q ? t("Nothing matches “{q}”.", { q }) : t("No context yet.")}</p>
        ) : (
          <>
            {sources.length > 0 && (
              <section className="card space-y-3 p-4">
                <h2 className="text-sm font-semibold text-zinc-500 uppercase">
                  {t("From Teams & GitLab")} <span className="font-normal normal-case text-zinc-400">({sources.length})</span>
                </h2>
                <SourceList>
                  {sources.map((c) => (
                    <ContextCard key={c.id} item={c} tickets={tickets} entities={entities} />
                  ))}
                </SourceList>
              </section>
            )}
            {notes.length > 0 && (
              <section className="card space-y-3 p-4">
                <h2 className="text-sm font-semibold text-zinc-500 uppercase">
                  {t("Notes")} <span className="font-normal normal-case text-zinc-400">({notes.length})</span>
                </h2>
                {notes.map((c) => (
                  <ContextCard key={c.id} item={c} tickets={tickets} entities={entities} />
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </ContextFormOptionsProvider>
  );
}
