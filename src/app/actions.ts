"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { parallelSaid } from "@/lib/entry-parallel";
import { getJobNumberForTicket, createEntry, deleteEntry, updateEntry, getEntry, requireEntry, applyReportRuleTagsToEntries, reapplyMeetingJobRules, applyTypeRulesToEntries } from "@/lib/entries";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatHours } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { setPauses } from "@/lib/pauses";
import { setDefaultTags } from "@/lib/default-tags";
import { createJob, updateJob, deleteJob } from "@/lib/jobs";
import { createProject, updateProject, deleteProject } from "@/lib/projects";
import { parseBookOn } from "@/lib/projects-shared";
import { ENTRY_CONTEXT_PREFIX } from "@/lib/contexts-shared";
import { syncGitlabAction } from "@/plugins/gitlab/server-actions";
import { accountsOn, entryTypeFrom, int, num, revalidateAll, str, tagsFrom, type ActionState } from "@/app/action-helpers";
import { integrationServer } from "@/lib/integrations/server";
import { syncKeepAction } from "@/plugins/keep/server-actions";
import { syncTeamsAction } from "@/plugins/teams/server-actions";
import { syncWhatsappAction } from "@/plugins/whatsapp/server-actions";
import { syncSignalAction } from "@/plugins/signal/server-actions";

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

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export async function createJobAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const job = createJob({
      number: str(fd, "number") ?? "",
      name: str(fd, "name") ?? "",
      customer: str(fd, "customer"),
      description: str(fd, "description"),
    });
    setDefaultTags({ job: job.id }, tagsFrom(fd, "defaultTags"));
    revalidateAll();
    return { ok: true, message: t("Created job {number} — {name}.", { number: job.number, name: job.name }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function updateJobAction(
  id: number,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  try {
    const job = updateJob(id, {
      number: str(fd, "number") ?? "",
      name: str(fd, "name") ?? "",
      customer: str(fd, "customer") ?? "",
      description: str(fd, "description") ?? "",
      active: fd.get("active") === "on",
    });
    setDefaultTags({ job: job.id }, tagsFrom(fd, "defaultTags"));
    revalidateAll();
    return { ok: true, message: t("Saved job {number}.", { number: job.number }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function toggleJobActiveAction(fd: FormData): Promise<void> {
  const id = int(fd, "id");
  if (id === undefined) return;
  try {
    updateJob(id, { active: fd.get("active") === "true" });
    revalidateAll();
  } catch (err) {
    console.error("toggleJobActiveAction", err);
  }
}

export async function deleteJobAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = int(fd, "id");
  if (id === undefined) return { ok: false, error: t("Missing job id.") };
  try {
    deleteJob(id);
    revalidateAll();
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
  redirect("/jobs");
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

function projectFields(fd: FormData) {
  return {
    title: str(fd, "title") ?? "",
    description: str(fd, "description") ?? "",
    customer: str(fd, "customer") ?? "",
    jobNumber: str(fd, "jobNumber") ?? "",
    startDate: str(fd, "startDate") ?? "",
    endDate: str(fd, "endDate") ?? "",
  };
}

export async function createProjectAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const project = createProject(projectFields(fd));
    setDefaultTags({ project: project.id }, tagsFrom(fd, "defaultTags"));
    revalidateAll();
    return {
      ok: true,
      message: project.job
        ? t("Created project {title} on {job}.", { title: project.title, job: project.job.number })
        : t("Created project {title} (no job yet).", { title: project.title }),
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function updateProjectAction(
  id: number,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  try {
    const { project, moved } = updateProject(id, { ...projectFields(fd), active: fd.get("active") === "on" });
    setDefaultTags({ project: project.id }, tagsFrom(fd, "defaultTags"));
    revalidateAll();
    const where = project.job ? `${project.job.number} — ${project.job.name}` : t("No job yet");
    return {
      ok: true,
      message:
        t("Saved project {title}.", { title: project.title }) +
        (moved ? ` ${moved === 1 ? t("Moved 1 entry to {where}.", { where }) : t("Moved {n} entries to {where}.", { n: moved, where })}` : ""),
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Book one entry per working day of a date range on a project (e.g. a 3-day training). */
export async function bookProjectDaysAction(
  projectId: number,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  try {
    const { bookProjectDays } = await import("@/lib/project-days");
    const { booked, skipped } = bookProjectDays({
      projectId,
      from: str(fd, "from") ?? "",
      to: str(fd, "to") ?? "",
      hours: num(fd, "hours"),
      fillUp: fd.get("fillUp") === "on",
      description: str(fd, "description") ?? "",
      type: entryTypeFrom(fd),
    });
    revalidateAll();
    const total = booked.reduce((a, b) => a + b.hours, 0);
    const skippedText = skipped.length
      ? ` ${t("Skipped {days}.", { days: skipped.map((s) => `${s.date} (${s.reason})`).join(", ") })}`
      : "";
    if (booked.length === 0) return { ok: false, error: `${t("Nothing to book.")}${skippedText}` };
    return {
      ok: true,
      message:
        (booked.length === 1
          ? t("Booked {hours} h on 1 day.", { hours: formatHours(total) })
          : t("Booked {hours} h on {n} days.", { hours: formatHours(total), n: booked.length })) + skippedText,
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function toggleProjectActiveAction(fd: FormData): Promise<void> {
  const id = int(fd, "id");
  if (id === undefined) return;
  try {
    updateProject(id, { active: fd.get("active") === "true" });
    revalidateAll();
  } catch (err) {
    console.error("toggleProjectActiveAction", err);
  }
}

export async function deleteProjectAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = int(fd, "id");
  if (id === undefined) return { ok: false, error: t("Missing project id.") };
  try {
    deleteProject(id);
    revalidateAll();
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
  redirect("/projects");
}

// ---------------------------------------------------------------------------
// Working hours & absences
// ---------------------------------------------------------------------------

export async function saveScheduleAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { updateWorkSchedule, WEEKDAY_KEYS } = await import("@/lib/schedule");
  try {
    const hours = Object.fromEntries(
      WEEKDAY_KEYS.map((k) => [k, num(fd, k) ?? 0]),
    ) as Record<(typeof WEEKDAY_KEYS)[number], number>;
    updateWorkSchedule(hours);
    revalidateAll();
    return { ok: true, message: t("Working hours saved.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The default break on workdays (shown as a shadow in the Pause row) and whether Punch records it. */
export async function saveDefaultPausesAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { updateDefaultPauses } = await import("@/lib/schedule");
  try {
    const s = updateDefaultPauses(str(fd, "defaultPauses") ?? "", fd.get("punchDefaultPauses") === "on");
    revalidateAll();
    return { ok: true, message: s.defaultPauses ? t("Default break saved: {pauses}.", { pauses: s.defaultPauses }) : t("Default break removed.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Schedule → Flex time: the Gleitzeit job (none = off) and the comment its bookings get. */
export async function saveFlexTimeAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const jobNumber = str(fd, "flexJobNumber") ?? null;
    const { getJobByNumber } = await import("@/lib/jobs");
    const job = jobNumber ? getJobByNumber(jobNumber) : undefined;
    if (jobNumber && !job) return { ok: false, error: t("There's no job {job}.", { job: jobNumber }) };
    const { getFlexTime, updateFlexTime } = await import("@/lib/schedule");
    const flex = getFlexTime(updateFlexTime({ jobNumber: job?.number ?? null, comment: str(fd, "flexComment") ?? "" }));
    revalidateAll();
    return { ok: true, message: job ? t("Flex time goes to {job} as “{comment}”.", { job: job.number, comment: flex.comment }) : t("Flex time is off.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * The weekly table's flex-time row: book the days' missing hours on the Gleitzeit job with its
 * comment. The gaps are worked out from what's booked now, not taken from the page.
 */
export async function bookFlexTimeAction(dates: string[]): Promise<ActionState> {
  try {
    const { bookFlexTime } = await import("@/lib/flex-time");
    const r = bookFlexTime(Array.isArray(dates) ? dates.map(String) : []);
    if (!r.booked.length) {
      const why = r.skipped.map((s) => `${s.label} ${s.reason}`).join(", ");
      return { ok: false, error: why ? t("Nothing to book — {why}.", { why }) : t("Nothing to book.") };
    }
    revalidateAll();
    const hours = r.booked.reduce((a, b) => a + b.hours, 0);
    return {
      ok: true,
      message: t("Booked {hours} h “{comment}” on {job}: {days}.", {
        hours: formatHours(hours),
        comment: r.comment,
        job: r.jobNumber,
        days: r.booked.map((b) => `${b.label} ${t("{hours} h", { hours: formatHours(b.hours) })}`).join(", "),
      }),
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function createAbsenceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { createAbsence } = await import("@/lib/schedule");
  try {
    const start = str(fd, "startDate") ?? "";
    const end = str(fd, "endDate") || start;
    const type = (str(fd, "type") ?? "vacation") as "vacation" | "sick" | "holiday" | "other";
    const hours = num(fd, "hours");
    const a = createAbsence({ startDate: start, endDate: end, type, hours: hours ?? null, note: str(fd, "note") ?? null });
    revalidateAll();
    const label = { vacation: t("vacation"), sick: t("sick"), holiday: t("holiday"), other: t("other") }[type] ?? type;
    const dates = `${a.startDate}${a.endDate !== a.startDate ? `–${a.endDate}` : ""}`;
    return { ok: true, message: t("Added {type} {dates}.", { type: label, dates }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function deleteAbsenceAction(fd: FormData): Promise<void> {
  const id = int(fd, "id");
  if (id === undefined) return;
  const { deleteAbsence } = await import("@/lib/schedule");
  try {
    deleteAbsence(id);
    revalidateAll();
  } catch (err) {
    console.error("deleteAbsenceAction", err);
  }
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Entry types (Tags page)
// ---------------------------------------------------------------------------

export async function createEntryTypeAction(label: string, color: string): Promise<ActionState> {
  try {
    const { createEntryType } = await import("@/lib/entry-types");
    const type = createEntryType({ label, color });
    revalidateAll();
    return { ok: true, message: t("Added type {label}.", { label: type.label }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Save renamed / recolored types. */
export async function saveEntryTypesAction(updates: { key: string; label: string; color: string }[]): Promise<ActionState> {
  try {
    const { updateEntryTypes } = await import("@/lib/entry-types");
    const n = updateEntryTypes(updates);
    revalidateAll();
    return { ok: true, message: n === 1 ? t("Saved 1 type.") : t("Saved {n} types.", { n }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function deleteEntryTypeAction(key: string): Promise<ActionState> {
  try {
    const { deleteEntryType } = await import("@/lib/entry-types");
    deleteEntryType(key);
    revalidateAll();
    return { ok: true, message: t("Type deleted.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function createTagAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { createTag } = await import("@/lib/tags");
  try {
    const tag = createTag(str(fd, "name") ?? "", str(fd, "color"));
    revalidateAll();
    return { ok: true, message: t("Added tag #{name}.", { name: tag.name }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function renameTagAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = int(fd, "id");
  if (id === undefined) return { ok: false, error: t("Missing tag id.") };
  const { renameTag } = await import("@/lib/tags");
  try {
    const tag = renameTag(id, str(fd, "name") ?? "", str(fd, "color") ?? null);
    revalidateAll();
    return { ok: true, message: t("Saved #{name}.", { name: tag.name }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function deleteTagAction(fd: FormData): Promise<void> {
  const id = int(fd, "id");
  if (id === undefined) return;
  const { deleteTag } = await import("@/lib/tags");
  try {
    deleteTag(id);
    revalidateAll();
  } catch (err) {
    console.error("deleteTagAction", err);
  }
}

// ---------------------------------------------------------------------------
// Report settings
// ---------------------------------------------------------------------------

/** Save the report rules; "Save & tag existing entries" (apply=1) also gives older entries their rule's tags. */
export async function saveReportSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { updateReportSettings } = await import("@/lib/report");
  const { parseRules } = await import("@/lib/report-shared");
  try {
    const rules = parseRules(str(fd, "rules") ?? null);
    updateReportSettings({ rules });
    const tagged = fd.get("apply") === "1" ? applyReportRuleTagsToEntries() : null;
    revalidateAll();
    return {
      ok: true,
      message:
        tagged === null
          ? t("Report rules saved.")
          : tagged === 1
            ? t("Report rules saved; tagged 1 existing entry.")
            : t("Report rules saved; tagged {n} existing entries.", { n: tagged }),
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function saveMeetingJobRulesAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { updateReportSettings, parseMeetingJobRules } = await import("@/lib/report");
  const { listJobs } = await import("@/lib/jobs");
  try {
    const rules = parseMeetingJobRules(str(fd, "meetingJobRules") ?? null);
    const defaultJob = str(fd, "meetingDefaultJob") ?? null;
    if (defaultJob && !listJobs({ includeInactive: true }).some((j) => j.number === defaultJob)) {
      return { ok: false, error: t("Unknown job {job}.", { job: defaultJob }) };
    }
    updateReportSettings({ meetingJobRules: rules, meetingDefaultJob: defaultJob });
    // "Save & reapply" (apply=1): also re-book already imported meetings that match a rule.
    const moves = fd.get("apply") === "1" ? reapplyMeetingJobRules(rules) : null;
    revalidateAll();
    if (moves === null) {
      return { ok: true, message: rules.length === 1 ? t("Saved 1 meeting rule.") : t("Saved {n} meeting rules.", { n: rules.length }) };
    }
    const saved = rules.length === 1 ? t("Saved 1 meeting rule") : t("Saved {n} meeting rules", { n: rules.length });
    const moved = moves.length === 1 ? t("moved 1 imported meeting") : t("moved {n} imported meetings", { n: moves.length });
    const shown = moves
      .slice(0, 5)
      .map((m) => `${formatDate(m.date, { weekday: false })} “${m.description}” → ${m.to}`)
      .join("; ");
    return {
      ok: true,
      message:
        `${saved}; ${moved}` +
        (moves.length ? `: ${shown}${moves.length > 5 ? "; …" : ""}.` : "."),
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * Exclude / Include toggle on the import page: excluding adds the meeting's title as an
 * exclude rule (unless one already matches it); including removes every rule matching it.
 * Returns the resulting rules so the page can re-check its other meetings.
 */
export async function setMeetingExcludedAction(
  title: string,
  exclude: boolean,
): Promise<{ ok: boolean; error?: string; rules?: string[] }> {
  const { getMeetingExcludeRules, getReportSettings, updateReportSettings } = await import("@/lib/report");
  const { isExcludedMeeting } = await import("@/lib/calendar/meetings");
  const name = (title ?? "").trim();
  if (!name) return { ok: false, error: t("The meeting has no title.") };
  try {
    const rules = getMeetingExcludeRules(getReportSettings());
    const next = exclude
      ? isExcludedMeeting(name, rules) ? rules : [...rules, name]
      : rules.filter((r) => !isExcludedMeeting(name, [r]));
    updateReportSettings({ meetingExcludeRules: next });
    revalidateAll();
    return { ok: true, rules: next };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Save the entry type rules; the "Save & apply" button (apply=1) also re-types existing entries. */
export async function saveTypeRulesAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { updateReportSettings } = await import("@/lib/report");
  const { parseTypeRules } = await import("@/lib/type-rules-shared");
  const { listJobs } = await import("@/lib/jobs");
  try {
    const rules = parseTypeRules(str(fd, "typeRules") ?? null);
    const known = new Set(listJobs({ includeInactive: true }).map((j) => j.number));
    const unknown = rules.find((r) => r.jobNumber && !known.has(r.jobNumber));
    if (unknown) return { ok: false, error: t("Unknown job {job}.", { job: unknown.jobNumber }) };
    updateReportSettings({ typeRules: rules });
    const applied = fd.get("apply") === "1" ? applyTypeRulesToEntries() : null;
    revalidateAll();
    const n = rules.length;
    if (applied === null) return { ok: true, message: n === 1 ? t("Saved 1 type rule.") : t("Saved {n} type rules.", { n }) };
    const saved = n === 1 ? t("Saved 1 type rule") : t("Saved {n} type rules", { n });
    const retyped = applied === 1 ? t("re-typed 1 existing entry.") : t("re-typed {n} existing entries.", { n: applied });
    return { ok: true, message: `${saved}; ${retyped}` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function saveMeetingExcludeRulesAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { parseMeetingExcludeRules, updateReportSettings } = await import("@/lib/report");
  try {
    const rules = parseMeetingExcludeRules(str(fd, "meetingExcludeRules") ?? null);
    updateReportSettings({ meetingExcludeRules: rules });
    revalidateAll();
    return { ok: true, message: rules.length === 1 ? t("Saved 1 exclude rule.") : t("Saved {n} exclude rules.", { n: rules.length }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A service's sign-in shown in the automation Chrome (its tab at the front, else a new one) — you sign in there yourself. */
export async function openServiceLoginAction(service: string): Promise<ActionState> {
  try {
    const { openServiceLogin, serviceLabel } = await import("@/lib/attention");
    if (!serviceLabel(service)) return { ok: false, error: t("Unknown service.") };
    const r = await openServiceLogin(service);
    return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * The menu's "Anpassen": an application's place (header, menu, hidden) — or another entry hidden or
 * shown — or a section's new order (`order`: its entries' addresses, "group:<plugin>" for plugins).
 */
export async function saveMenuAction(change: { href?: string; place?: string; hidden?: boolean; order?: string[] }): Promise<ActionState> {
  try {
    const { getMenuPrefs, setMenuPrefs } = await import("@/plugins/tabs");
    const cur = getMenuPrefs();
    if (Array.isArray(change?.order)) {
      const keys = change.order.map(String).filter((k) => k.startsWith("/") || k.startsWith("group:"));
      // The section's entries last, in their new order (only their order among themselves counts).
      setMenuPrefs({ order: [...cur.order.filter((k) => !keys.includes(k)), ...keys] });
      revalidatePath("/", "layout");
      return { ok: true, message: t("Saved.") };
    }
    const href = String(change?.href ?? "");
    if (!href.startsWith("/")) return { ok: false, error: t("Not a menu entry.") };
    if (change.place === "header" || change.place === "menu" || change.place === "hidden") setMenuPrefs({ place: { ...cur.place, [href]: change.place } });
    else if (typeof change.hidden === "boolean") setMenuPrefs({ hidden: change.hidden ? [...new Set([...cur.hidden, href])] : cur.hidden.filter((h) => h !== href) });
    revalidatePath("/", "layout");
    return { ok: true, message: t("Saved.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A header tab's dropdown (its plugin's entries — Kanban: the boards), loaded when it opens. */
export async function tabMenuAction(tab: string): Promise<import("@/plugins/tab-menus-shared").TabMenuItem[]> {
  try {
    return await (await import("@/plugins/tab-menus")).tabMenu(String(tab));
  } catch {
    return [];
  }
}

/** The setup's end (or skipped): done — on to the sign-ins (Logins page). */
export async function finishSetupAction(): Promise<void> {
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ setupDoneAt: new Date().toISOString() });
  revalidateAll();
  redirect("/todos");
}

/** The setup skipped: done, home. */
export async function skipSetupAction(): Promise<void> {
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ setupDoneAt: new Date().toISOString() });
  redirect("/");
}

/** The Logins page: ask a service's driver whether it's signed in (read-only — nothing opened, Chrome not started). */
export async function checkLoginAction(service: string): Promise<ActionState> {
  try {
    const { serviceLabel } = await import("@/lib/attention");
    if (!serviceLabel(service)) return { ok: false, error: t("Unknown service.") };
    const { checkLogin } = await import("@/lib/logins");
    const r = await checkLogin(service);
    revalidatePath("/logins");
    return r.state === "ok" ? { ok: true, message: r.detail } : { ok: false, error: r.detail };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The Logins page's "Alle prüfen": each checkable service in turn (they share one Chrome). */
export async function checkAllLoginsAction(): Promise<ActionState> {
  try {
    const { checkLogin, listLogins } = await import("@/lib/logins");
    const { logins } = await listLogins();
    let ok = 0;
    const todo = logins.filter((l) => l.checkable);
    for (const l of todo) if ((await checkLogin(l.service)).state === "ok") ok++;
    revalidatePath("/logins");
    return { ok: true, message: t("{ok} of {n} signed in.", { ok, n: todo.length }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Signed in: try the service again (its sync, or its status) — the request goes once it works. */
export async function retryServiceAction(service: string): Promise<ActionState> {
  try {
    if (service === "teams") return await syncTeamsAction();
    if (service === "outlook" || service === "gmail") return await syncMailAction();
    if (service === "whatsapp") return await syncWhatsappAction();
    if (service === "signal") return await syncSignalAction();
    if (service === "keep") return await syncKeepAction();
    if (service === "gitlab") return await syncGitlabAction();
    if (service === "jira") {
      const { syncAndWait } = await import("@/lib/sync/registry");
      const r = await syncAndWait("jira");
      revalidateAll();
      return r.lastOk ? { ok: true, message: t("Jira works again.") } : { ok: false, error: r.lastMessage ?? t("Failed.") };
    }
    // The mounted integrations' (Chrono, Punch): their driver's status check.
    const own = integrationServer(service)?.service;
    if (own) {
      const msg = await own.status();
      revalidateAll();
      return /not signed in/i.test(msg) ? { ok: false, error: msg } : { ok: true, message: msg };
    }
    return { ok: false, error: t("Unknown service.") };
  } catch (err) {
    revalidateAll();
    return { ok: false, error: errorMessage(err) };
  }
}

/** A request put off: gone till the service asks again. */
export async function dismissAttentionAction(key: string): Promise<ActionState> {
  const { clearAttention } = await import("@/lib/attention");
  clearAttention(String(key));
  revalidateAll();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Context (colleagues' messages, Teams messages, Jira comments behind entries)
// ---------------------------------------------------------------------------

/**
 * A context form's fields: kind, headline, author, date, ticket, message and its links
 * (link-url-i / link-label-i) — each name with `p` in front (the entry form's "Add context").
 */
function contextInputOf(fd: FormData, p = ""): import("@/lib/contexts-shared").ContextInput {
  const links = Array.from({ length: int(fd, `${p}linkCount`) ?? 0 }, (_, i) => ({
    url: str(fd, `${p}link-url-${i}`) ?? "",
    label: str(fd, `${p}link-label-${i}`) ?? null,
  }));
  const body = fd.get(`${p}body`);
  return {
    kind: (str(fd, `${p}kind`) ?? "note") as import("@/lib/contexts-shared").ContextKind,
    title: str(fd, `${p}title`) ?? null,
    author: str(fd, `${p}author`) ?? null,
    body: typeof body === "string" ? body : "",
    links,
    date: str(fd, `${p}date`) ?? null,
    ticket: str(fd, `${p}ticket`) ?? null,
  };
}

/** The files a context form uploads (the browser posts an empty one when none was picked). */
function contextFilesOf(fd: FormData, p = ""): File[] {
  return fd.getAll(`${p}files`).filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && f.size > 0);
}

/** Pictures pasted into the message: each with the token its ![image](paste:token) reference uses. */
function contextPastedOf(fd: FormData, p = ""): { token: string; file: File }[] {
  return Array.from({ length: int(fd, `${p}pastedCount`) ?? 0 }, (_, i) => ({ token: str(fd, `${p}pasted-token-${i}`) ?? "", file: fd.get(`${p}pasted-file-${i}`) }))
    .filter((x): x is { token: string; file: File } => !!x.token && typeof x.file === "object" && x.file !== null && "arrayBuffer" in x.file);
}

/** The entry form's "+ Add context" (ctx- fields), when something was written there — else null. */
function entryContextOf(fd: FormData) {
  if (!fd.has(`${ENTRY_CONTEXT_PREFIX}linkCount`)) return null;
  const input = contextInputOf(fd, ENTRY_CONTEXT_PREFIX);
  const files = contextFilesOf(fd, ENTRY_CONTEXT_PREFIX);
  const pasted = contextPastedOf(fd, ENTRY_CONTEXT_PREFIX);
  const written = input.body.trim() || input.title || input.links.some((l) => l.url.trim()) || files.length || pasted.length;
  return written ? { input, files, pasted } : null;
}

/**
 * Pictures pasted as links (a GitLab or Jira screenshot): download them, to keep with the item
 * as its own files — straight from the web, or through the automation Chrome for sites you're
 * signed in to there. Read-only.
 */
export async function fetchImagesAction(urls: string[]): Promise<import("@/lib/contexts-shared").FetchedImage[]> {
  if (!Array.isArray(urls)) return [];
  const { fetchRemoteImages } = await import("@/lib/remote-images");
  return fetchRemoteImages(urls.map(String));
}

/** Mails matching words (sender, subject, text) — for the source picker; a few, newest first. */
export async function searchMailsAction(q: string): Promise<import("@/lib/mail/shared").MailView[]> {
  const text = String(q ?? "").trim();
  if (text.length < 2) return [];
  const { listMails } = await import("@/lib/mail/store");
  return listMails({ q: text, limit: 6 });
}

/** "Sync now" on the Nachrichten page: read the inbox's latest mails in the automation Chrome (read-only: none opened; opens Outlook's mail there if needed). */
export async function syncMailAction(): Promise<ActionState> {
  // Through the Sync menu's step: stoppable from there (and from the page's button).
  const { syncAndWait } = await import("@/lib/sync/registry");
  const r = await syncAndWait("mail");
  revalidateAll();
  return r.lastOk ? { ok: true, message: r.lastMessage ?? "" } : { ok: false, error: r.lastMessage ?? t("Failed.") };
}

/** Which Outlook folders the mail sync reads, by name as Outlook lists them ("Posteingang, Notifications"). */
export async function saveMailFoldersAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const text = String(fd.get("folders") ?? "");
  const folders = [...new Set(text.split(",").map((f) => f.trim()).filter(Boolean))].slice(0, 12);
  if (!folders.length) return { ok: false, error: t("At least one folder (e.g. Posteingang).") };
  const { updateMailSettings } = await import("@/lib/mail/store");
  updateMailSettings({ folders });
  revalidateAll();
  return { ok: true, message: t("Reads: {folders}.", { folders: folders.join(", ") }) };
}

/** The Sync settings page: how often one sync runs by itself (an installed plugin's — its settings module sets it). */
export async function saveSyncIntervalAction(key: string, minutes: number): Promise<ActionState> {
  const { findSyncInterval } = await import("@/plugins/sync-settings-modules");
  const i = findSyncInterval(String(key));
  if (!i) return { ok: false, error: t("There is no such sync (plugin not installed?).") };
  const m = Math.round(Number(minutes));
  if (!Number.isFinite(m) || m < 0 || m > Math.max(...i.choices, i.get())) return { ok: false, error: t("Not a valid interval.") };
  i.set(m);
  revalidateAll();
  const { minutesText } = await import("@/plugins/sync-settings");
  return { ok: true, message: minutesText(m, t) };
}

// ---------------------------------------------------------------------------
// The header's sync menu (every sync, its last run, its next)
// ---------------------------------------------------------------------------

/** Every sync step: running?, how it last went, when it runs next by itself. */
export async function syncOverviewAction(): Promise<import("@/lib/sync/shared").SyncOverview> {
  const { syncOverview } = await import("@/lib/sync/registry");
  const overview = syncOverview();
  // How each source holds up (cached a minute): a dot and why on the steps that aren't well.
  try {
    const { sourceHealth } = await import("@/lib/sync/source-health");
    const { healthReason } = await import("@/lib/sync/source-health-shared");
    const health = (await sourceHealth()).flatMap((h) => (h.state === "ok" ? [] : [{ key: h.key, state: h.state, reason: healthReason(t, h) }]));
    return { ...overview, health };
  } catch (e) {
    console.error("[sync] source health", e);
    return overview;
  }
}

/** One step, started in the background (the menu follows it). */
export async function runSyncAction(key: string): Promise<ActionState> {
  const { isSyncKey, startSync } = await import("@/lib/sync/registry");
  if (!isSyncKey(key)) return { ok: false, error: t("Unknown sync.") };
  const r = await startSync(key);
  return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
}

/** Stop a sync that's running (Sync menu, a page's button) — and what it started. */
export async function stopSyncAction(key: string): Promise<ActionState> {
  const { stopSync } = await import("@/lib/sync/registry");
  return (await stopSync(String(key))) ? { ok: true, message: t("Stopping.") } : { ok: false, error: t("Not running.") };
}

/** Stop "Sync all" (the step it's on, and the rest). */
export async function stopSyncAllAction(): Promise<ActionState> {
  const { stopSyncAll } = await import("@/lib/sync/registry");
  return (await stopSyncAll()) ? { ok: true, message: t("Stopping.") } : { ok: false, error: t("Not running.") };
}

/** "Sync all": every step one after the other, in the background. */
export async function runSyncAllAction(): Promise<ActionState> {
  const { startSyncAll } = await import("@/lib/sync/registry");
  const r = await startSyncAll();
  return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
}

/**
 * The entry's context search: add a synced Teams message or GitLab item to the entry — as an
 * item of its own, the one there is for its link when there is one.
 */
export async function addContextSourceAction(entryId: number, url: string, ticket: string | null): Promise<ActionState> {
  try {
    const { resolveLinks } = await import("@/lib/context-links");
    const e = resolveLinks([String(url)])[String(url).trim()];
    if (!e) return { ok: false, error: t("That isn't a synced Teams message or GitLab item.") };
    const { addSource } = await import("@/lib/contexts");
    addSource(String(url), e, { entryId, ticket });
    revalidateAll();
    return { ok: true, message: t("Added.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** "Add context": a new item (with its files), linked to the entry when there is one. */
export async function createContextAction(entryId: number | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { createContext } = await import("@/lib/contexts");
    await createContext(contextInputOf(fd), contextFilesOf(fd), entryId ?? undefined, contextPastedOf(fd));
    revalidateAll();
    return { ok: true, message: t("Context added.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function updateContextAction(contextId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { updateContext } = await import("@/lib/contexts");
    await updateContext(contextId, contextInputOf(fd), contextFilesOf(fd), contextPastedOf(fd));
    revalidateAll();
    return { ok: true, message: t("Context saved.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function deleteContextAction(fd: FormData): Promise<void> {
  const id = int(fd, "id");
  if (id === undefined) return;
  const { deleteContext } = await import("@/lib/contexts");
  deleteContext(id);
  revalidateAll();
}

export async function deleteContextFileAction(fd: FormData): Promise<void> {
  const id = int(fd, "id");
  if (id === undefined) return;
  const { deleteContextFile } = await import("@/lib/contexts");
  deleteContextFile(id);
  revalidateAll();
}

/** "Link existing": put an item that's already there on this entry too. */
export async function linkContextAction(entryId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const contextId = int(fd, "contextId");
    if (contextId === undefined) return { ok: false, error: t("Pick a context item to link.") };
    const { linkContext } = await import("@/lib/contexts");
    linkContext(entryId, contextId);
    revalidateAll();
    return { ok: true, message: t("Context linked.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function unlinkContextAction(fd: FormData): Promise<void> {
  const entryId = int(fd, "entryId");
  const contextId = int(fd, "contextId");
  if (entryId === undefined || contextId === undefined) return;
  const { unlinkContext } = await import("@/lib/contexts");
  unlinkContext(entryId, contextId);
  revalidateAll();
}

/** An entry's context dragged into a new order (item ids, first to last). */
export async function reorderEntryContextsAction(entryId: number, contextIds: number[]): Promise<ActionState> {
  try {
    if (!Number.isInteger(entryId) || !Array.isArray(contextIds) || !contextIds.every(Number.isInteger)) return { ok: false, error: t("Nothing to reorder.") };
    const { reorderEntryContexts } = await import("@/lib/contexts");
    reorderEntryContexts(entryId, contextIds);
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * "Sync to Jira": post the items to their Jira tickets (a comment each, edited when they
 * changed since) and attach their files. A write to Jira — only ever run from that button.
 */
export async function syncContextsToJiraAction(contextIds: number[]): Promise<ActionState> {
  try {
    const { syncContextsToJira } = await import("@/lib/jira/context-sync");
    const r = await syncContextsToJira(contextIds);
    revalidateAll();
    const parts = [
      r.posted.length && t("{n} posted", { n: r.posted.length }),
      r.updated.length && t("{n} updated", { n: r.updated.length }),
      r.unchanged.length && t("{n} already up to date", { n: r.unchanged.length }),
      r.files.length && (r.files.length === 1 ? t("1 file attached") : t("{n} files attached", { n: r.files.length })),
      r.skipped.length && t("{n} without a ticket", { n: r.skipped.length }),
    ].filter(Boolean);
    const summary = parts.length ? `${parts.join(", ")}.` : t("Nothing to sync.");
    return r.errors.length
      ? { ok: false, error: t("{summary} Failed: {errors}", { summary, errors: r.errors.join("; ") }) }
      : { ok: true, message: t("Jira: {summary}", { summary }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Feierabend: the day's lines booked as you took them over (meetings, suggestions, tickets). */
export async function bookDayAction(date: string, rows: import("@/lib/feierabend").DayBooking[]): Promise<ActionState | (NonNullable<ActionState> & { created?: import("@/lib/feierabend").BookedStamp[] })> {
  try {
    if (!(await import("@/plugins/state")).isInstalled("zeiterfassung")) return { ok: false, error: t("Time tracking is not installed (Menu → Plugins).") };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return { ok: false, error: t("Not a day.") };
    const { bookDay } = await import("@/lib/feierabend");
    const r = await bookDay(String(date), Array.isArray(rows) ? rows.slice(0, 60) : []);
    revalidateAll();
    const base = r.skipped
      ? t("{booked} booked ({hours} h), {skipped} already booked", { booked: r.booked, hours: formatHours(r.hours), skipped: r.skipped })
      : t("{booked} booked ({hours} h)", { booked: r.booked, hours: formatHours(r.hours) });
    const itemsSaid = r.items ? `${base}, ${r.items === 1 ? t("1 itemized under the group entry") : t("{n} itemized under the group entry", { n: r.items })}` : base;
    const said = r.parallel ? `${itemsSaid}, ${r.parallel === 1 ? t("1 grouped as parallel work") : t("{n} grouped as parallel work", { n: r.parallel })}` : itemsSaid;
    return r.errors.length ? { ok: false, error: t("{said} — not booked: {errors}", { said, errors: r.errors.join("; ") }), created: r.created } : { ok: true, message: `${said}.`, created: r.created };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Takes a Feierabend booking back: deletes the entries it created, only those still as booked. */
export async function undoBookDayAction(created: { id: number; updatedAt: string }[]): Promise<ActionState> {
  try {
    const list = (Array.isArray(created) ? created : []).slice(0, 60).map((c) => ({ id: Number(c?.id), updatedAt: String(c?.updatedAt) })).filter((c) => Number.isInteger(c.id));
    const { undoBooking } = await import("@/lib/feierabend");
    const r = await undoBooking(list);
    revalidateAll();
    return { ok: true, message: r.kept ? t("{n} taken back, {kept} left (changed since)", { n: r.deleted, kept: r.kept }) : t("{n} taken back", { n: r.deleted }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * A booked entry's context from its todos — after the answer (the Jira read takes a while): the
 * conversations as they are now, then what the todos came from attached.
 */
async function attachContextLater(entryId: number, ticket: string | null, todoIds: number[]) {
  if (!todoIds.length) return;
  try {
    const { attachTodoContext, commentTickets } = await import("@/lib/work/booking");
    const { refreshTicketComments } = await import("@/lib/boards/collect");
    await refreshTicketComments(commentTickets(todoIds)).catch(() => 0);
    attachTodoContext(entryId, ticket, todoIds);
  } catch (e) {
    console.error("[booking context]", errorMessage(e));
  }
}

/** An agent's suggested booking, taken over with the hours and words you settled on (a real entry, its evidence as context). */
export async function acceptSuggestionAction(id: number, edits: { hours?: number; description?: string }): Promise<ActionState> {
  try {
    const { acceptSuggestion } = await import("@/lib/work/suggestions");
    // Booked at once; its context (the conversations as Jira has them now) comes right after.
    const r = acceptSuggestion(Number(id), { hours: edits?.hours === undefined ? undefined : Number(edits.hours), description: edits?.description === undefined ? undefined : String(edits.description) }, { context: false });
    after(() => attachContextLater(r.entryId, r.ticket, r.todoIds));
    revalidateAll();
    return {
      ok: true,
      message: r.parallel
        ? `${r.ticket ? t("Booked {hours} h on {ticket}.", { hours: formatHours(r.hours), ticket: r.ticket }) : t("Booked {hours} h.", { hours: formatHours(r.hours) })} ${parallelSaid(r.parallel)}`
        : r.ticket
        ? t("Booked {hours} h on {ticket}.", { hours: formatHours(r.hours), ticket: r.ticket })
        : t("Booked {hours} h.", { hours: formatHours(r.hours) }),
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** An agent's suggested booking, not to be booked. */
export async function skipSuggestionAction(id: number): Promise<ActionState> {
  try {
    const { skipSuggestion } = await import("@/lib/work/suggestions");
    skipSuggestion(Number(id));
    revalidateAll();
    return { ok: true, message: t("Suggestion dismissed.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A ticket's todos done today, booked as one entry with the hours and words you settled on (Weekly report) — or skipped. */
export async function bookDoneTodayAction(v: { ticket: string; todoIds: number[]; hours: number; description: string; skip?: boolean }): Promise<ActionState> {
  try {
    const { bookDoneToday } = await import("@/lib/work/booking");
    // Booked at once; its context (the conversations as Jira has them now) comes right after.
    const r = bookDoneToday({ ticket: String(v.ticket), todoIds: Array.isArray(v.todoIds) ? v.todoIds : [], hours: Number(v.hours), description: String(v.description ?? ""), skip: !!v.skip, context: false });
    if (r.entryId) {
      const entryId = r.entryId;
      after(() => attachContextLater(entryId, String(v.ticket), r.todoIds));
    }
    revalidateAll();
    return {
      ok: true,
      message: v.skip
        ? t("{ticket}: not suggested any more.", { ticket: v.ticket })
        : t("Booked {hours} h on {ticket}.", { hours: formatHours(r.hours), ticket: v.ticket }),
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Into a new account and its setup assistant. */
export async function startSetupAction(id: string): Promise<ActionState> {
  try {
    const off = await accountsOn();
    if (off) return { ok: false, error: off };
    await (await import("@/lib/accounts")).startSetup(String(id));
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
  revalidateAll();
  redirect("/setup");
}

/**
 * Windows' folder dialog, opened on this machine (Zeff runs here) — the folder picked, or null
 * when cancelled. In front of the other windows; the server isn't held up while it's open.
 */
export async function pickFolderAction(initial?: string): Promise<{ ok: boolean; path?: string | null; error?: string }> {
  if (process.platform !== "win32") return { ok: false, error: t("The folder dialog is only available on Windows — please type the path.") };
  const { execFile } = await import("node:child_process");
  const script = [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "Add-Type -AssemblyName System.Windows.Forms",
    "$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; WindowState = 'Minimized' }",
    "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$d.Description = $env:ZEFF_PICK_TITLE",
    "$d.ShowNewFolderButton = $true",
    "if ($env:ZEFF_PICK_INITIAL -and (Test-Path -LiteralPath $env:ZEFF_PICK_INITIAL)) { $d.SelectedPath = $env:ZEFF_PICK_INITIAL }",
    "if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }",
  ].join("; ");
  return new Promise((resolve) =>
    execFile(
      "powershell.exe",
      ["-NoProfile", "-STA", "-NonInteractive", "-Command", script],
      { encoding: "utf8", timeout: 5 * 60000, windowsHide: true, env: { ...process.env, ZEFF_PICK_INITIAL: initial ?? "", ZEFF_PICK_TITLE: t("Folder for Zeff backups") } },
      (err, out) => (err ? resolve({ ok: false, error: t("The dialog didn't open: {error}", { error: errorMessage(err) }) }) : resolve({ ok: true, path: String(out).trim() || null })),
    ),
  );
}

// ---------------------------------------------------------------------------
// Plugins (connectors and AI tools): installed or not
// ---------------------------------------------------------------------------

/** Install or uninstall a plugin — its data stays; what it does (menu, pages, syncs) comes or goes. */
export async function setPluginInstalledAction(id: string, installed: boolean): Promise<ActionState> {
  try {
    const { isPluginId, pluginById } = await import("@/plugins/catalog");
    if (!isPluginId(id)) return { ok: false, error: t("Unknown plugin.") };
    const { dependents, setInstalled } = await import("@/plugins/state");
    // Uninstalled: what builds on it goes too (it stays set, and is back once this is).
    const along = installed ? [] : dependents(id);
    const ids = setInstalled(id, !!installed);
    // Knowledge in or out: the launcher starts or stops this account's knowledge server.
    (await import("@/plugins/knowledge/instances")).writeKnowledgeInstances();
    revalidateAll();
    const names = (list: string[]) => list.map((x) => (isPluginId(x) ? pluginById(x).name : x)).join(", ");
    return {
      ok: true,
      message:
        (installed ? t("{name} installed.", { name: pluginById(id).name }) : t("{name} uninstalled.", { name: pluginById(id).name })) +
        (ids.length > 1 ? ` ${t("Installed along with it: {names}.", { names: names(ids.slice(1)) })}` : "") +
        (along.length ? ` ${t("Not available without it: {names}.", { names: names(along) })}` : ""),
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** The language Zeff speaks in this account (Settings) — one of the installed language bundles. */
export async function setLanguageAction(lang: string): Promise<ActionState> {
  try {
    const { setLanguage } = await import("@/lib/i18n/server");
    setLanguage(String(lang));
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** Setup's "Open all sign-in pages": a tab per service that isn't signed in yet, in the automation Chrome — you sign in there yourself. */
export async function openAllSignInsAction(): Promise<ActionState> {
  try {
    const { listLogins } = await import("@/lib/logins");
    const { openServiceLogin } = await import("@/lib/attention");
    const { logins } = await listLogins();
    const open = logins.filter((l) => l.state !== "ok");
    if (!open.length) return { ok: true, message: t("Everything is signed in.") };
    const failed: string[] = [];
    for (const l of open) if (!(await openServiceLogin(l.service)).ok) failed.push(l.label);
    revalidatePath("/logins");
    return failed.length
      ? { ok: false, error: t("Couldn't open: {names}. Is a browser installed?", { names: failed.join(", ") }) }
      : { ok: true, message: t("{n} sign-in pages are open in the automation Chrome — sign in to each, then click Check all.", { n: open.length }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** "Install" on the This PC list: winget (Homebrew) installs it in the background; `all` takes every missing program that can be installed. */
export async function installPrerequisiteAction(id: string): Promise<ActionState> {
  try {
    const { prerequisites } = await import("@/lib/prerequisites");
    const { installPlan, startInstall } = await import("@/lib/prerequisites-install");
    const { hasCommand } = await import("@/plugins/documents/poppler");
    const rows = prerequisites();
    const todo = id === "all" ? rows.filter((r) => !r.found && installPlan(r.id, process.platform, hasCommand)) : rows.filter((r) => r.id === id && !r.found);
    if (!todo.length) return { ok: false, error: t("Nothing to install.") };
    for (const r of todo) startInstall(r.id, { plan: installPlan(r.id, process.platform, hasCommand), found: () => !!(rows.length && prerequisites().find((x) => x.id === r.id)?.found), after: () => void signInAfterInstall(r.id) });
    return { ok: true, message: t("Installing {n} program(s) — this takes a few minutes.", { n: todo.length }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** A freshly installed AI CLI: its sign-in opens right away (the browser asks you to sign in). */
async function signInAfterInstall(id: string): Promise<void> {
  if (id !== "claude" && id !== "codex" && id !== "copilot") return;
  (await import("@/lib/ai-login")).startAiLogin(id);
}

/** What the installs are doing (polled by the This PC list). */
export async function installStatusAction(): Promise<{ id: string; state: string; out: string; note: string; at: string }[]> {
  const { installStates } = await import("@/lib/prerequisites-install");
  return installStates().map(({ id, state, out, note, at }) => ({ id, state, out, note: note ?? "", at }));
}

/** "Sign in" on the This PC list: the AI CLI's own login (opens the browser; Zeff never sees a password). */
export async function aiLoginAction(provider: string): Promise<ActionState> {
  try {
    const { isAiProvider } = await import("@/lib/ai/shared");
    if (!isAiProvider(provider)) return { ok: false, error: t("Unknown provider.") };
    const { startAiLogin } = await import("@/lib/ai-login");
    const s = startAiLogin(provider);
    return s.state === "failed" ? { ok: false, error: s.out } : { ok: true, message: t("The sign-in page opens in your browser — sign in there.") };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Where the AI CLIs' sign-ins are: running / done / failed (with the address when the browser didn't open), and whether each is signed in. */
export async function aiLoginStatusAction(): Promise<{ provider: string; state: string; url: string | null; out: string; signedIn: boolean | null }[]> {
  const { AI_PROVIDERS } = await import("@/lib/ai/shared");
  const { aiSignedIn, loginStates, loginCommands } = await import("@/lib/ai-login");
  const states = new Map(loginStates().map((s) => [s.provider, s]));
  return Promise.all(
    AI_PROVIDERS.filter((p) => loginCommands(p)).map(async (p) => {
      const s = states.get(p);
      return { provider: p, state: s?.state ?? "idle", url: s?.url ?? null, out: s?.out ?? "", signedIn: s?.state === "running" ? null : s?.state === "done" && !loginCommands(p)?.status ? true : await aiSignedIn(p) };
    }),
  );
}

/** The diagnostics report (redacted) — shown on the page, copied or saved by the user; Zeff sends it nowhere. */
export async function diagnosticsAction(): Promise<{ ok: boolean; text?: string; error?: string }> {
  try {
    const { diagnosticsReport } = await import("@/lib/diagnostics");
    return { ok: true, text: await diagnosticsReport() };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
