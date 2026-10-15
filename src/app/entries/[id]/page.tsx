import { EmptyState } from "@/components/EmptyState";
import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { rich } from "@/lib/i18n/rich";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { createContextAction, deleteEntryAction, linkContextAction, updateEntryAction } from "@/app/actions";
import { ContextCard } from "@/components/ContextCard";
import { SpanBar } from "@/components/SpanBar";
import { entryRow, getSpan, membersOf, spanOfHead, workedOf } from "@/lib/entry-spans";
import { EntrySourceRows } from "@/components/EntrySourceRows";
import { EntryTodoContextSection } from "@/components/EntryTodoContext";
import { entryTodoContext } from "@/lib/entry-todo-context";
import { ContextFormOptionsProvider } from "@/components/ContextFormOptions";
import { ContextSyncButton } from "@/components/ContextSyncButton";
import { EntryContextAdders } from "@/components/EntryContextAdders";
import { EntrySourceAdder } from "@/components/EntrySourceAdder";
import { EntryForm, type TicketSuggestionLite } from "@/components/EntryForm";
import { LinkContextForm } from "@/components/LinkContextForm";
import { resolveLinks } from "@/lib/context-links";
import { contextsForEntry, listContextPeople, listContexts } from "@/lib/contexts";
import { contextHeadline, contextKindLabels, itemSource, jiraSyncState } from "@/lib/contexts-shared";
import { getTicketCards } from "@/lib/jira/store";
import { SubmitButton } from "@/components/SubmitButton";
import { listDefaultTagMaps } from "@/lib/default-tags";
import { listEntryTypes } from "@/lib/entry-types";
import { getEntry } from "@/lib/entries";
import { formatHours } from "@/lib/format";
import { isNoJobPlaceholder, listJobs } from "@/lib/jobs";
import { listProjectOptions } from "@/lib/projects";
import { getEntryTicketSuggestions } from "@/lib/ticket-suggestions";
import { listTags } from "@/lib/tags";
import { weekFromDate } from "@/lib/week";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Edit entry") };
}

export default async function EntryPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const entryId = Number(id);
  if (!Number.isInteger(entryId)) notFound();
  const entry = getEntry(entryId);
  if (!entry) notFound();

  // Offer active jobs and projects, plus the entry's own even if deactivated (never the "No job yet" placeholder).
  const jobs = listJobs().map((j) => ({ id: j.id, number: j.number, name: j.name, customer: j.customer }));
  const projects = listProjectOptions(entry.projectId);
  if (!isNoJobPlaceholder(entry.job) && !jobs.some((j) => j.id === entry.jobId)) {
    jobs.unshift({ id: entry.job.id, number: entry.job.number, name: entry.job.name, customer: entry.job.customer });
  }
  const week = weekFromDate(new Date(entry.date + "T00:00:00"));
  const allTags = listTags().map((tag) => tag.name);
  const ticketSuggestions = getEntryTicketSuggestions(week);

  return (
    <div className="page">
      <div className="page-aside">
        <div>
          <Link href={`/?week=${week.key}`} className="text-sm text-zinc-500 hover:underline">
            {t("← Week {n}", { n: week.week })}
          </Link>
          <h1 className="text-lg font-semibold">
            {rich(
              t("Entry #{id} · {hours}h on <target>{target}</target>", {
                id: entry.id,
                hours: formatHours(entry.hours),
                target: entry.project ? entry.project.title : entry.job.number,
              }),
              { target: (s) => (entry.project ? s : <span className="font-mono">{s}</span>) },
            )}
          </h1>
          <p className="text-sm text-zinc-500">
            {t("Reported by {who} via {source} · created {at} UTC", { who: entry.reportedBy, source: entry.source, at: entry.createdAt })}
          </p>
        </div>
        <form action={deleteEntryAction}>
          <input type="hidden" name="id" value={entry.id} />
          <input type="hidden" name="redirectTo" value="/?week={date}" />
          <SubmitButton
            className="btn btn-danger"
            pendingText={t("Deleting…")}
            confirm={t("Delete this {hours}h entry?", { hours: formatHours(entry.hours) })}
          >
            {t("Delete entry")}
          </SubmitButton>
        </form>
      </div>

      <section className="card p-4">
        <EntryForm
          jobs={jobs}
          projects={projects}
          action={updateEntryAction.bind(null, entry.id)}
          submitLabel={t("Save")}
          resetOnSuccess={false}
          allTags={allTags}
          ticketSuggestions={ticketSuggestions}
          defaultTagMaps={listDefaultTagMaps()}
          types={listEntryTypes()}
          defaults={{
            jobNumber: entry.job.number,
            projectId: entry.projectId ?? undefined,
            date: entry.date,
            // (a task of grouped work edits what it worked; what it books follows the group)
            hours: entry.spanId ? workedOf(entry) : entry.hours,
            description: entry.description,
            ticket: entry.ticket ?? "",
            reportedBy: entry.reportedBy,
            type: entry.type,
            tags: entry.tags.map((tag) => tag.name),
            isGroup: entry.isGroup,
            start: entry.start ?? "",
          }}
        />
      </section>

      {/* Parallel work, kept whole: the group this entry belongs to (or is the head of) — how it is booked, and its tasks with what they worked and book. */}
      {(() => {
        const span = entry.spanId ? getSpan(entry.spanId) : entry.isGroup ? spanOfHead(entry.id) : undefined;
        if (!span) return null;
        const members = membersOf(span.id);
        const head = span.headId ? entryRow(span.headId) : null;
        return (
          <section className="card space-y-3 p-4">
            <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Grouped parallel work")}</h2>
            <SpanBar span={span} head={head ? { id: head.id, hours: head.hours, workedHours: head.workedHours, start: head.start } : null} members={members.map((m) => ({ id: m.id, hours: m.hours, workedHours: m.workedHours, start: m.start }))} />
            <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
              {[...(head ? [head] : []), ...members].map((m) => (
                <li key={m.id} className={`flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5 ${m.id === entry.id ? "font-medium" : ""}`}>
                  <span className="w-12 shrink-0 font-mono text-xs text-zinc-500">{m.start ?? ""}</span>
                  <span className="w-28 shrink-0 text-xs tabular-nums">
                    {m.id === head?.id ? t("books {h} h", { h: formatHours(m.hours) }) : `${formatHours(workedOf(m))} h · ${t("books {h} h", { h: formatHours(m.hours) })}`}
                  </span>
                  {m.ticket && <span className="font-mono text-xs text-zinc-500">{m.ticket}</span>}
                  <Link href={`/entries/${m.id}`} className="min-w-0 flex-1 hover:underline">
                    {m.description}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })()}

      {/* The todos (and runs) that flowed into it, with their whole context — as the todos show it. */}
      {(() => {
        const ctx = entryTodoContext([entry.id])[entry.id];
        return ctx ? <EntryTodoContextSection ctx={ctx} /> : null;
      })()}

      <ContextSection entryId={entry.id} ticket={entry.ticket} date={entry.date} ticketOptions={ticketSuggestions} />
    </div>
  );
}

/**
 * The entry's context: the search that adds Teams messages and GitLab items, those as rows,
 * notes as cards; writing a note, linking an existing item; syncing to Jira.
 */
function ContextSection({
  entryId,
  ticket,
  date,
  ticketOptions,
}: {
  entryId: number;
  ticket: string | null;
  date: string;
  /** Tickets to pick for an item (the entry form's suggestions). */
  ticketOptions: TicketSuggestionLite[];
}) {
  const items = contextsForEntry(entryId);
  const linked = new Set(items.map((c) => c.id));
  const options = listContexts({ limit: 300 })
    .filter((c) => !linked.has(c.id))
    .map((c) => ({
      id: c.id,
      label: [contextKindLabels(t)[c.kind], c.author, c.date, c.ticket, contextHeadline(c, t)].filter(Boolean).join(" · "),
    }));
  const toSync = items.filter((c) => ["unsynced", "changed"].includes(jiraSyncState(c)));
  const tickets = getTicketCards(items.map((c) => c.ticket));
  // A synced Teams message or GitLab item of its own is a badge row; notes are cards.
  const entities = resolveLinks(items.flatMap((c) => c.links.map((l) => l.url)));
  const sources = items.filter((c) => itemSource(c, entities));
  const notes = items.filter((c) => !itemSource(c, entities));
  const people = listContextPeople();

  return (
    <ContextFormOptionsProvider value={{ people, tickets: ticketOptions }}>
      <section id="context" className="card scroll-mt-4 space-y-3 p-4">
        <div className="flex min-h-7 flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">
            {t("Context")} <span className="font-normal normal-case text-zinc-400">({items.length})</span>
          </h2>
          {/* One at a time is each row's own Sync. */}
          {toSync.length > 1 && (
            <ContextSyncButton ids={toSync.map((c) => c.id)} tickets={toSync.map((c) => c.ticket!)} label={t("Sync {n} to Jira", { n: toSync.length })} />
          )}
        </div>
        <EntrySourceAdder entryId={entryId} ticket={ticket} linked={items.flatMap((c) => c.links.map((l) => l.url))} />
        {sources.length > 0 && <EntrySourceRows entryId={entryId} items={sources} tickets={tickets} entities={entities} />}
        {notes.map((c) => (
          <ContextCard key={c.id} item={c} entryId={entryId} tickets={tickets} entities={entities} />
        ))}
        {items.length === 0 && (
          <EmptyState>{t("Nothing yet — search Teams and GitLab above for what colleagues wrote about this work, or write a note.")}</EmptyState>
        )}
        <EntryContextAdders
          noteAction={createContextAction.bind(null, entryId)}
          noteDefaults={{ ticket, date }}
          link={options.length > 0 ? <LinkContextForm action={linkContextAction.bind(null, entryId)} options={options} /> : undefined}
        />
      </section>
    </ContextFormOptionsProvider>
  );
}
