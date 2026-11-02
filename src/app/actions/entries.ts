"use server";

import { redirect } from "@/lib/redirect";
import { parallelSaid } from "@/lib/entry-parallel";
import { getJobNumberForTicket, createEntry, deleteEntry, updateEntry, getEntry, requireEntry } from "@/lib/entries";
import { errorMessage } from "@/lib/errors";
import { formatHours } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { setPauses } from "@/lib/pauses";
import { setDefaultTags } from "@/lib/default-tags";
import { parseBookOn } from "@/lib/projects-shared";
import { entryTypeFrom, int, num, revalidateAll, str, tagsFrom, type ActionState } from "@/app/action-helpers";
import { entryContextOf } from "./context-form";

// ---------------------------------------------------------------------------
// Time entries
// ---------------------------------------------------------------------------

export async function createEntryAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const hours = num(fd, "hours");
    if (hours === undefined) return { ok: false, error: t("Hours is required (e.g. 1.5).") };
    const ticket = str(fd, "ticket");
    const bookOn = parseBookOn(str(fd, "bookOn") ?? str(fd, "jobNumber"));
    // Reuse the job a ticket was last booked on when none was chosen.
    const ticketJob = !bookOn && ticket ? getJobNumberForTicket(ticket) : undefined;
    const target = bookOn ?? (ticketJob ? { jobNumber: ticketJob } : undefined);
    if (!target) return { ok: false, error: t("Pick a job or a project to book on.") };
    // "+ Add context": checked before booking, so a bad link or ticket doesn't leave the entry half-saved.
    const context = entryContextOf(fd);
    const contexts = context ? await import("@/lib/contexts") : null;
    if (context && contexts) {
      try {
        contexts.validateContextInput(context.input, { hasFiles: context.files.length + context.pasted.length > 0 });
      } catch (err) {
        return { ok: false, error: t("Context: {error}", { error: errorMessage(err) }) };
      }
    }
    const date = str(fd, "date") ?? "";
    const start = str(fd, "start");
    const isGroup = fd.get("isGroup") === "on";
    const entry = createEntry(
      {
        ...target,
        date,
        hours,
        description: str(fd, "description") ?? "",
        comment: str(fd, "comment") ?? null,
        ticket,
        type: entryTypeFrom(fd),
        tags: tagsFrom(fd),
        isGroup,
        start,
        reportedBy: str(fd, "reportedBy"),
      },
      "web",
      { defaultTags: false }, // the form pre-fills the defaults (and lets you remove them)
    );
    if (context && contexts) {
      try {
        await contexts.createContext(context.input, context.files, entry.id, context.pasted);
      } catch (err) {
        deleteEntry(entry.id); // both or neither — the form keeps everything to try again
        throw err;
      }
    }
    // Parallel work stays whole: a new collecting entry (a mob day) takes in what that day has and runs parallel to it; other
    // work is grouped with what it runs parallel to (a collecting entry, tasks of its job at the same time) unless "Separate entry" is chosen.
    const { autoGroup, collectIntoHead, parallelSaid } = await import("@/lib/entry-parallel");
    let grouped = "";
    if (entry.isGroup) {
      const n = collectIntoHead(entry.id);
      if (n) grouped = n === 1 ? t("1 parallel entry of that day was grouped under it.") : t("{n} parallel entries of that day were grouped under it.", { n });
    } else if (str(fd, "placement") !== "separate") {
      const g = autoGroup(entry.id);
      if (g) grouped = parallelSaid(g);
    }
    revalidateAll();
    const v = { hours: formatHours(hours), project: entry.project?.title, job: entry.job.name, number: entry.job.number, date: entry.date };
    const base = entry.project
      ? context
        ? t("Booked {hours}h on {project} ({job}) for {date} — with its context.", v)
        : t("Booked {hours}h on {project} ({job}) for {date}.", v)
      : context
        ? t("Booked {hours}h on {number} for {date} — with its context.", v)
        : t("Booked {hours}h on {number} for {date}.", v);
    return { ok: true, message: grouped ? `${base} ${grouped}` : base };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function updateEntryAction(
  id: number,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  let date: string;
  try {
    const hours = num(fd, "hours");
    if (hours === undefined) return { ok: false, error: t("Hours is required (e.g. 1.5).") };
    const bookOn = parseBookOn(str(fd, "bookOn") ?? str(fd, "jobNumber"));
    const wasGroup = getEntry(id)?.isGroup ?? false;
    const entry = updateEntry(id, {
      ...(bookOn && ("projectId" in bookOn ? bookOn : { jobNumber: bookOn.jobNumber, projectId: null })),
      date: str(fd, "date"),
      hours,
      description: str(fd, "description"),
      // (The comment box is on the form only once opened: absent means unchanged, an empty one clears it.)
      ...(fd.has("comment") ? { comment: str(fd, "comment") ?? null } : {}),
      ticket: str(fd, "ticket") ?? null,
      type: entryTypeFrom(fd),
      tags: tagsFrom(fd),
      reportedBy: str(fd, "reportedBy"),
      isGroup: fd.get("isGroup") === "on",
      start: str(fd, "start") ?? null,
    });
    date = entry.date;
    // Made a collecting entry now: what that day has and runs parallel to it is grouped under it (nothing is moved or rewritten).
    if (entry.isGroup && !wasGroup) (await import("@/lib/entry-parallel")).collectIntoHead(entry.id);
    revalidateAll();
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
  redirect(`/?week=${date}`);
}

/** Inline edit from the entries table: change just the hours of one entry. */
export async function updateEntryHoursAction(id: number, hours: number): Promise<ActionState> {
  try {
    if (!Number.isFinite(hours)) return { ok: false, error: t("Enter hours as a number, e.g. 1.5.") };
    const entry = updateEntry(id, { hours });
    revalidateAll();
    // (a task of grouped parallel work: what was worked — what it books follows the group's way of booking)
    return { ok: true, message: t("{hours} h", { hours: formatHours(entry.workedHours ?? entry.hours) }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function deleteEntryAction(fd: FormData): Promise<void> {
  const id = int(fd, "id");
  if (id === undefined) return;
  let redirectTo: string | undefined;
  try {
    const entry = deleteEntry(id);
    redirectTo = str(fd, "redirectTo")?.replace("{date}", entry.date);
    revalidateAll();
  } catch (err) {
    console.error("deleteEntryAction", err);
    return;
  }
  if (redirectTo) redirect(redirectTo);
}

/** Default tags of a ticket (Jira tab): added to every entry booked on it. */
export async function setTicketTagsAction(ticket: string, tags: string[]): Promise<ActionState> {
  try {
    if (!ticket.trim()) return { ok: false, error: t("Missing ticket.") };
    const saved = setDefaultTags({ ticket }, tags);
    revalidateAll();
    return { ok: true, message: saved.length ? saved.map((tag) => `#${tag}`).join(" ") : t("No default tags.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Set the break(s) of one or more days from the weekly table's Pause row ("12:00-12:30", "12 30m"; empty removes). */
export async function setPausesAction(dates: string[], text: string, defaultStart?: string): Promise<ActionState> {
  try {
    const saved = setPauses(dates, text, defaultStart);
    revalidateAll();
    const n = dates.length;
    const message = saved.none
      ? n === 1 ? t("Marked as no break.") : t("Marked as no break on {n} days.", { n })
      : saved.pauses.length
        ? n === 1 ? t("Saved the break.") : t("Saved the break on {n} days.", { n })
        : n === 1 ? t("Removed the break.") : t("Removed the break on {n} days.", { n });
    return { ok: true, message };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Duplicate an entry onto another day (same job, hours, description, ticket, type, tags). */
export async function copyEntryAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = int(fd, "id");
  const date = str(fd, "date")?.trim();
  if (id === undefined) return { ok: false, error: t("Missing entry to copy.") };
  if (!date) return { ok: false, error: t("Pick a day to copy to.") };
  try {
    const src = requireEntry(id);
    createEntry(
      {
        ...(src.projectId ? { projectId: src.projectId } : { jobNumber: src.job.number }),
        date,
        hours: src.hours,
        description: src.description,
        ticket: src.ticket ?? undefined,
        type: src.type,
        reportedBy: src.reportedBy,
        tags: src.tags.map((tag) => tag.name),
      },
      "web",
      { defaultTags: false }, // a copy keeps the original's tags
    );
    revalidateAll();
    return { ok: true, message: t("Copied {hours} h to {date}.", { hours: formatHours(src.hours), date }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
