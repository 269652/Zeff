import { EmptyState } from "@/components/EmptyState";
import Link from "next/link";
import { deleteEntryAction } from "@/app/actions";
import { contextBriefs } from "@/lib/contexts";
import { entryTodoContext } from "@/lib/entry-todo-context";
import type { EntryWithJob } from "@/lib/entries";
import { entryTypeMap } from "@/lib/entry-types";
import { getTicketCards } from "@/lib/jira/store";
import { formatHours } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { NO_JOB_NUMBER } from "@/lib/projects-shared";
import { integrationClient } from "@/lib/integrations/client";
import type { IntegrationMarks } from "@/lib/integrations/types";
import { CollapsibleTags } from "./CollapsibleTags";
import { CopyEntryButton } from "./CopyEntryButton";
import { EntryHoursCell } from "./EntryHoursCell";
import { ProjectWithJob } from "./ProjectWithJob";
import { SubmitButton } from "./SubmitButton";
import { ContextHoverIcon } from "./ContextHoverIcon";
import { EntryTodoContextToggle } from "./EntryTodoContext";
import { TrashIcon } from "./icons";
import { TicketLink } from "./TicketLink";
import { TypeBadge } from "./TypeBadge";

export function EntriesTable({
  entries,
  showJob = true,
  showProject = true,
  marks,
}: {
  entries: EntryWithJob[];
  /** What the mounted integrations know of the entries (Chrono's statuses once the week was pulled): approved hours read green with a ✓. */
  marks?: IntegrationMarks;
  showJob?: boolean;
  /** Without a job column, show each entry's project in a Project column (when any has one). */
  showProject?: boolean;
}) {
  if (entries.length === 0) {
    return <EmptyState variant="centered">{t("No entries.")}</EmptyState>;
  }
  const projectColumn = !showJob && showProject && entries.some((e) => e.project);
  const types = entryTypeMap();
  // The integrations that have something to say of these entries (Chrono once the week was pulled).
  const plugins = Object.entries(marks ?? {}).flatMap(([id, data]) => {
    const client = integrationClient(id);
    return client && data.entries ? [{ id, client, data }] : [];
  });
  // Entries with context get an info icon leading to their edit page, with a hover card of the items.
  const briefs = contextBriefs(entries.map((e) => e.id));
  // And the context of the todos that flowed into it, as the todos show it.
  const fromTodos = entryTodoContext(entries.map((e) => e.id));
  const contextTickets = Object.values(briefs).flatMap((b) => b.items.map((i) => i.ticket));
  const ticketCards = getTicketCards([...entries.map((e) => e.ticket), ...contextTickets]);
  const ticketUrls = Object.fromEntries(Object.entries(ticketCards).map(([key, card]) => [key, card.url]));
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>{t("Date")}</th>
            {showJob && <th>{t("Job")}</th>}
            {projectColumn && <th>{t("Project")}</th>}
            <th className="num">{t("Hours")}</th>
            <th className="w-full">{t("Description")}</th>
            <th>{t("Ticket")}</th>
            <th className="whitespace-nowrap">{t("Type · Tags")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
              <td className="font-mono whitespace-nowrap">{e.date}</td>
              {showJob && (
                // Titles only — the job number is in the tooltip — on one line: the column grows to fit them.
                <td className="whitespace-nowrap">
                  {e.project ? (
                    <ProjectWithJob project={e.project} job={e.job} titleOnly />
                  ) : e.job.number === NO_JOB_NUMBER ? (
                    <Link href="/projects" className="badge badge-nojob">{t("No job yet")}</Link>
                  ) : (
                    <Link href={`/jobs/${e.job.id}`} className="hover:underline" title={e.job.number}>
                      {e.job.name}
                    </Link>
                  )}
                </td>
              )}
              {projectColumn && (
                <td className="whitespace-nowrap">
                  {e.project && (
                    <Link href={`/projects/${e.project.id}`} className="badge badge-project hover:underline">
                      {e.project.title}
                    </Link>
                  )}
                </td>
              )}
              <td className={`num font-semibold whitespace-nowrap ${plugins.find((p) => p.client.entryApproved?.(p.data.entries![e.id]))?.client.approvedClass ?? ""}`}>
                <EntryHoursCell entryId={e.id} hours={e.hours} />
                {plugins.map((p) => (p.client.EntryMark ? <p.client.EntryMark key={p.id} item={p.data.entries![e.id]} /> : null))}
              </td>
              <td>
                {/* The description opens the entry; the context icon sits at the cell's right edge, level with the first line. */}
                <div className="flex items-start gap-2">
                  <Link href={`/entries/${e.id}`} className="min-w-0 flex-1 hover:underline" title={t("Edit this entry")}>
                    {e.description}
                  </Link>
                  {briefs[e.id] && <ContextHoverIcon entryId={e.id} brief={briefs[e.id]} ticketUrls={ticketUrls} />}
                </div>
                {fromTodos[e.id] && <EntryTodoContextToggle ctx={fromTodos[e.id]} />}
              </td>
              <td className="whitespace-nowrap">
                {e.ticket && <TicketLink ticket={e.ticket} card={ticketCards[e.ticket.toUpperCase()]} />}
              </td>
              <td>
                <CollapsibleTags tags={e.tags} lead={<TypeBadge type={e.type} types={types} />} />
              </td>
              <td className="whitespace-nowrap">
                <div className="flex justify-end gap-1">
                  <CopyEntryButton entryId={e.id} date={e.date} />
                  <form action={deleteEntryAction}>
                    <input type="hidden" name="id" value={e.id} />
                    <SubmitButton
                      className="icon-btn icon-btn-danger"
                      pendingText="…"
                      confirm={t("Delete {hours}h on {job} ({date})?", { hours: formatHours(e.hours), job: e.job.number, date: e.date })}
                      title={t("Delete this entry")}
                      label={t("Delete {hours} h on {job} ({date})", { hours: formatHours(e.hours), job: e.job.number, date: e.date })}
                    >
                      <TrashIcon />
                    </SubmitButton>
                  </form>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
