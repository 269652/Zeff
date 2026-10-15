import { EmptyState } from "@/components/EmptyState";
import Link from "next/link";
import { Fragment } from "react";
import { DragEntryRow, GroupDropRow } from "./EntryDnd";
import { GroupMenu } from "./GroupMenu";
import { EntryStartCell } from "./EntryStartCell";
import { suggestedStarts } from "@/lib/entry-start";
import { SpanBar } from "./SpanBar";
import { deleteEntryAction } from "@/app/actions";
import { entryTodoContext } from "@/lib/entry-todo-context";
import type { EntryWithJob } from "@/lib/entries";
import { groupOptionsOn, type GroupOption } from "@/lib/entry-parallel";
import { getSpan, spanOfHead, type EntrySpan } from "@/lib/entry-spans";
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
import { EntryTodoContextToggle } from "./EntryTodoContext";
import { TrashIcon } from "./icons";
import { TicketLink } from "./TicketLink";
import { TypeBadge } from "./TypeBadge";

const rowClass = "hover:bg-zinc-50 dark:hover:bg-zinc-800/40";
const memberClass = "border-l-4 border-l-indigo-300 bg-indigo-50/30 hover:bg-indigo-50/60 dark:border-l-indigo-800 dark:bg-indigo-950/10 dark:hover:bg-indigo-950/30";
const headClass = "border-l-4 border-l-indigo-500 bg-indigo-50/60 hover:bg-indigo-50 dark:border-l-indigo-500 dark:bg-indigo-950/30";

/**
 * The entries of a period. Parallel work is shown whole: the tasks of a group (and its head — a
 * collecting entry like a mob day's 8 h, or a combined one) sit together under a bar that says how
 * the group is booked. Each task shows what it really worked and, small, what it books (what the
 * report and Chrono get). The entries on a day with a collecting entry can be switched into it or
 * dragged onto it.
 */
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
  // And the context of the todos that flowed into it, as the todos show it.
  const fromTodos = entryTodoContext(entries.map((e) => e.id));
  const ticketCards = getTicketCards(entries.map((e) => e.ticket));
  const columns = 5 + (showJob ? 1 : 0) + (projectColumn ? 1 : 0);

  // The groups of parallel work in this list: their head and their tasks.
  const spans = new Map<string, { span: EntrySpan; head: EntryWithJob | null; members: EntryWithJob[] }>();
  const spanOf = (e: EntryWithJob) => (e.spanId ? getSpan(e.spanId) : e.isGroup ? spanOfHead(e.id) : undefined);
  for (const e of entries) {
    const span = spanOf(e);
    if (!span || spans.has(span.id)) continue;
    spans.set(span.id, { span, head: entries.find((x) => x.id === span.headId) ?? null, members: entries.filter((x) => x.spanId === span.id) });
  }
  // The groups of each day — collecting entries (a day can have several: a mob day, a pairing session …) and groups of parallel
  // work: an entry joins one by its group mark, or is dragged onto a collecting entry.
  const groupsOfDay = new Map<string, GroupOption[]>();
  for (const date of new Set(entries.map((e) => e.date))) groupsOfDay.set(date, groupOptionsOn(date));

  // Start times can be set where they matter — in groups and on a day with a collecting entry; a suggestion from the work log where there is none.
  const startable = (e: EntryWithJob) => !!e.spanId || e.isGroup || !!groupsOfDay.get(e.date)?.length;
  const suggestions = suggestedStarts(entries.filter((e) => !e.start && startable(e)).map((e) => ({ id: e.id, date: e.date })));

  const rowFor = (e: EntryWithJob, cells: React.ReactNode) => {
    const asHead = e.isGroup ? spanOfHead(e.id) : undefined;
    if (asHead?.mode === "collect")
      return (
        <GroupDropRow spanId={asHead.id} date={e.date} className={headClass}>
          {cells}
        </GroupDropRow>
      );
    if (asHead) return <tr className={headClass}>{cells}</tr>;
    if (e.spanId) return <tr className={memberClass}>{cells}</tr>;
    return groupsOfDay.get(e.date)?.some((g) => g.kind === "collect") ? (
      <DragEntryRow entryId={e.id} date={e.date} className={rowClass}>
        {cells}
      </DragEntryRow>
    ) : (
      <tr className={rowClass}>{cells}</tr>
    );
  };

  const cellsOf = (e: EntryWithJob) => {
    const member = !!e.spanId;
    const own = e.isGroup ? spanOfHead(e.id) : undefined;
    // What the entry really is: for a task of a group what it worked, for a collecting entry its total — and, small, what each books.
    const real = e.workedHours ?? e.hours;
    return (
      <>
        <td className="font-mono whitespace-nowrap">
          {e.date}
          {startable(e) ? <EntryStartCell entryId={e.id} start={e.start} suggested={suggestions.get(e.id)} /> : e.start && <span className="block text-xs text-zinc-400">{e.start}</span>}
        </td>
        {showJob && (
          // Titles only — the job number is in the tooltip; a long name wraps rather than widening the table.
          <td className="max-w-40">
            {e.project ? (
              <ProjectWithJob project={e.project} job={e.job} titleOnly />
            ) : e.job.number === NO_JOB_NUMBER ? (
              <Link href="/projects" className="badge badge-nojob">
                {t("No job yet")}
              </Link>
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
          {/* A task of grouped work: what it really worked (editing it changes that), and small what it books — likewise a collecting entry. */}
          <EntryHoursCell entryId={e.id} hours={member || (own && !own.headAuto) ? real : e.hours} />
          {(member || own) && (
            <span className="block text-xs font-normal text-zinc-400" title={t("What this entry books — what the report and Chrono get. Its real hours stay as shown.")}>
              {t("books {h} h", { h: formatHours(e.hours) })}
            </span>
          )}
          {plugins.map((p) => (p.client.EntryMark ? <p.client.EntryMark key={p.id} item={p.data.entries![e.id]} /> : null))}
        </td>
        <td>
          {/* The description opens the entry; the context icon sits at the cell's right edge, level with the first line. */}
          <div className="flex items-start gap-2">
            <Link href={`/entries/${e.id}`} className="min-w-0 flex-1 hover:underline" title={t("Edit this entry")}>
              {e.description}
            </Link>
            <GroupMenu entryId={e.id} currentSpanId={e.spanId} headOfSpan={own?.id ?? null} options={groupsOfDay.get(e.date) ?? []} />
          </div>
          {fromTodos[e.id] && <EntryTodoContextToggle ctx={fromTodos[e.id]} />}
        </td>
        <td className="whitespace-nowrap">{e.ticket && <TicketLink ticket={e.ticket} card={ticketCards[e.ticket.toUpperCase()]} />}</td>
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
      </>
    );
  };

  // The rows: a group's bar, its head and its tasks together where its first entry is; other entries as they come.
  const shown = new Set<string>();
  const rows: React.ReactNode[] = [];
  for (const e of entries) {
    const span = spanOf(e);
    const info = span ? spans.get(span.id) : undefined;
    if (!info) {
      rows.push(<Fragment key={e.id}>{rowFor(e, cellsOf(e))}</Fragment>);
      continue;
    }
    if (shown.has(info.span.id)) continue;
    shown.add(info.span.id);
    rows.push(
      <Fragment key={`span-${info.span.id}`}>
        <tr className="bg-indigo-50 dark:bg-indigo-950/40">
          <td colSpan={columns} className="!py-2">
            <SpanBar
              span={info.span}
              head={info.head ? { id: info.head.id, hours: info.head.hours, workedHours: info.head.workedHours, start: info.head.start } : null}
              members={info.members.map((m) => ({ id: m.id, hours: m.hours, workedHours: m.workedHours, start: m.start }))}
            />
          </td>
        </tr>
        {[info.head, ...info.members]
          .filter((x): x is EntryWithJob => !!x)
          .map((x) => (
            <Fragment key={x.id}>{rowFor(x, cellsOf(x))}</Fragment>
          ))}
      </Fragment>,
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="table table-compact">
        <caption className="sr-only">{t("Time entries")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("Date")}</th>
            {showJob && <th scope="col">{t("Job")}</th>}
            {projectColumn && <th scope="col">{t("Project")}</th>}
            <th scope="col" className="num">{t("Hours")}</th>
            <th scope="col" className="w-full">{t("Description")}</th>
            <th scope="col">{t("Ticket")}</th>
            <th scope="col">{t("Type · Tags")}</th>
            <th scope="col"><span className="sr-only">{t("Actions")}</span></th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}
