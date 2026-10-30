import { workStart } from "@/lib/work/start";
import { and, desc, eq, gte, isNull, like, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { isInstalled } from "@/plugins/state";
import { t } from "@/lib/i18n/server";
import { addDays } from "@/lib/dates";

/** A line of the day's proposal: a meeting, an agent's suggestion, or a ticket you worked on. */
export type DayRow = {
  id: string;
  kind: "meeting" | "suggestion" | "ticket";
  /** Booked as it stands by default (meetings ticked in the calendar, suggestions, tickets with hours). */
  include: boolean;
  hours: number | null;
  jobNumber: string;
  description: string;
  ticket: string | null;
  /** Where it comes from, for the line ("10:00–11:00 · Teams", "S-12 · Claude", "1 todo done, Worker 45 min"). */
  from: string;
  /** A meeting's id (no double import), a suggestion's id. */
  externalId?: string;
  suggestionId?: number;
  /** A meeting that is a group meeting by your meeting rules (a mob day): the day's work is itemized under its entry. */
  group?: boolean;
  /** When it began ("HH:MM"): a meeting's start, or a ticket's first run — what makes work parallel to other work. */
  start?: string;
  /** You ticked "book it separately": this line is not itemized under the day's group entry. */
  standalone?: boolean;
};

/** `group`: the name of the group entry already booked today (a mob day), if any. */
export type DayProposal = { date: string; target: number; booked: number; group: string | null; rows: DayRow[]; jobs: { number: string; name: string }[] };

const quarter = (h: number) => Math.max(0.25, Math.round(h * 4) / 4);

/**
 * The day drafted for booking: the day's finished meetings not booked yet (with their job by your
 * meeting rules), the agents' open suggestions for it, and the tickets you worked on that day
 * (todos done, worker runs, your commits) that have no booking yet — a worker's time and line as a start,
 * else an estimate from your commits' span (said so). `now`: the day (an earlier day: its end, so all its meetings are over).
 */
export async function proposeDay(now = new Date()): Promise<DayProposal> {
  const { isoDate, weekFromDate } = await import("@/lib/week");
  const { listEntries, listBookedOnDates, getJobNumberForTicket } = await import("@/lib/entries");
  const { getDayTargets } = await import("@/lib/schedule");
  const { listJobs } = await import("@/lib/jobs");
  const date = isoDate(now);
  const target = getDayTargets([new Date(`${date}T12:00:00`)])[0]?.target ?? 0;
  const entries = listEntries({ from: date, to: date });
  const bookedTickets = new Set(entries.map((e) => (e.ticket ?? "").toUpperCase()).filter(Boolean));
  const jobs = listJobs().map((j) => ({ number: j.number, name: j.name }));
  const rows: DayRow[] = [];

  // Today's meetings, as the Calendar tab has them.
  if (isInstalled("outlook-calendar")) {
    const { getCalendarWeek } = await import("@/lib/calendar/week-view");
    const { getMeetingDefaultJob, getMeetingExcludeRules, getMeetingJobRules, getReportSettings } = await import("@/lib/report");
    const { groupForMeeting } = await import("@/lib/calendar/meetings");
    const settings = getReportSettings();
    const other = getMeetingDefaultJob(settings);
    const week = weekFromDate(now);
    const day = getCalendarWeek(week, {
      now,
      booked: listBookedOnDates(week.days.map(isoDate)),
      excludeRules: getMeetingExcludeRules(settings),
      jobRules: getMeetingJobRules(settings),
      defaultJob: (other && jobs.some((j) => j.number === other) ? other : jobs[0]?.number) ?? "",
    }).find((d) => d.date === date);
    for (const e of day?.events ?? [])
      if (e.state === "importable")
        rows.push({ id: `m:${e.externalId}`, kind: "meeting", include: e.selected, hours: e.hours, jobNumber: e.jobNumber, description: e.subject, ticket: e.ticket ?? null, from: `${e.startTime}–${e.endTime}${e.isTeams ? " · Teams" : ""}`, externalId: e.externalId, start: e.startTime, group: groupForMeeting(e.subject, getMeetingJobRules(settings)) });
  }

  // The agents' suggestions for today.
  const { openSuggestions } = await import("@/lib/work/suggestions");
  for (const s of openSuggestions().filter((x) => x.date === date))
    rows.push({ id: `s:${s.id}`, kind: "suggestion", include: true, hours: s.hours, jobNumber: s.job?.number ?? "", description: s.description, ticket: s.ticket, from: `${s.ref} · ${s.reportedBy}`, suggestionId: s.id });
  const suggested = new Set(rows.filter((r) => r.kind === "suggestion" && r.ticket).map((r) => r.ticket!.toUpperCase()));

  // The tickets you worked on today without a booking (or a suggestion) yet.
  if (isInstalled("todos")) {
    const db = getDb();
    const done = db
      .select({ id: schema.todos.id, ticket: schema.todos.ticket, text: schema.todos.text })
      .from(schema.todos)
      .where(and(eq(schema.todos.status, "done"), like(schema.todos.doneAt, `${date}%`)))
      .all();
    const runs = db
      .select({ ticket: schema.workRuns.ticket, durationMs: schema.workRuns.durationMs, entryLine: schema.workRuns.entryLine, summary: schema.workRuns.summary, startedAt: schema.workRuns.startedAt })
      .from(schema.workRuns)
      // That day's runs only (an earlier day's proposal: not the ones since).
      .where(and(gte(schema.workRuns.startedAt, `${date}T00:00`), lt(schema.workRuns.startedAt, `${nextDay(date)}T00:00`), isNull(schema.workRuns.entryId)))
      .all();
    const byTicket = new Map<string, { texts: string[]; ms: number; lines: string[]; start: string | null; todoIds: number[]; commits: string[] }>();
    const add = (t: string) => byTicket.get(t) ?? byTicket.set(t, { texts: [], ms: 0, lines: [], start: null, todoIds: [], commits: [] }).get(t)!;
    for (const d of done)
      if (d.ticket) {
        const g = add(d.ticket.toUpperCase());
        g.texts.push(d.text);
        g.todoIds.push(d.id);
      }
    for (const r of runs)
      if (r.ticket) {
        const g = add(r.ticket.toUpperCase());
        g.ms += r.durationMs ?? 0;
        const at = r.startedAt ? new Date(r.startedAt) : null;
        const hhmm = at && !Number.isNaN(at.getTime()) ? `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}` : null;
        if (hhmm && (!g.start || hhmm < g.start)) g.start = hhmm;
        if (r.entryLine) g.lines.push(r.entryLine);
      }
    // Your commits that day, per ticket (its key in the message or the branch): when you worked on it.
    for (const c of await commitsOn(date)) {
      const g = add(c.ticket);
      g.commits.push(c.at);
      if (!g.lines.length && !g.texts.length && c.subject) g.texts.push(c.subject);
    }
    for (const [ticket, g] of byTicket) {
      if (bookedTickets.has(ticket) || suggested.has(ticket)) continue;
      // No worker's time: your commits' span (first to last, and half an hour before the first) — an estimate, said so.
      const span = commitSpan(g.commits);
      // Workers running side by side add up past a day (agent time, not yours): at most the day's target, said so.
      const raw = g.ms ? quarter(g.ms / 3600000) : span ? span.hours : null;
      const capped = raw !== null && target > 0 && raw > target;
      const hours = capped ? target : raw;
      if (span && (!g.start || span.start < g.start)) g.start = span.start;
      const description = (g.lines[0] ?? g.texts[0] ?? "").replace(/\s+/g, " ").slice(0, 120);
      const from = [
        g.texts.length && g.todoIds.length && `${g.todoIds.length} todo${g.todoIds.length > 1 ? "s" : ""} done`,
        g.ms && `Worker ${Math.round(g.ms / 60000)} min`,
        g.commits.length && `${g.commits.length} commit${g.commits.length > 1 ? "s" : ""} ${span ? `${span.start}–${span.end}` : ""}${!g.ms && span ? ` (≈ ${span.hours} h, estimated)` : ""}`.trim(),
        capped && `capped at the day's ${target} h`,
      ]
        .filter(Boolean)
        .join(", ");
      // Its start: when the work on its todos began (runs, time records) — the earliest of that and the runs listed above.
      const began = workStart(date, { todoIds: g.todoIds });
      const start = [g.start, began].filter((x): x is string => !!x).sort()[0];
      rows.push({ id: `t:${ticket}`, kind: "ticket", include: !!hours, hours, jobNumber: getJobNumberForTicket(ticket) ?? "", description, ticket, from, ...(start ? { start } : {}) });
    }
  }

  // A day booked to its target already: nothing more ticked (shown, yours to tick) — booking it would go past the day.
  const booked = entries.reduce((s, e) => s + e.hours, 0);
  if (target > 0 && booked >= target) for (const r of rows) r.include = false;
  const { collectHeadsOn } = await import("@/lib/entry-parallel");
  return { date, target, booked, group: collectHeadsOn(date)[0]?.head.description ?? null, rows, jobs };
}

/** The day after a "YYYY-MM-DD". */
const nextDay = (date: string) => addDays(date, 1);

const KEY = /\b([A-Z][A-Z0-9]+-\d+)\b/;
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** Your commits on a day in every repo (your git email there), each with the ticket its message or branch names. */
async function commitsOn(date: string): Promise<{ ticket: string; at: string; subject: string }[]> {
  const out: { ticket: string; at: string; subject: string }[] = [];
  try {
    const { listRepos } = await import("@/lib/repos");
    const { gitText } = await import("@/lib/git");
    const next = nextDay(date);
    const seen = new Set<string>();
    for (const repo of listRepos().filter((r) => r.ok)) {
      const email = (await gitText(repo.path, ["config", "user.email"]).catch(() => "")).trim();
      if (!email) continue;
      const log = await gitText(repo.path, ["log", "--all", "--source", `--author=${email}`, `--since=${date} 00:00`, `--until=${next} 00:00`, "--date=iso-strict", "--format=%h%x09%ad%x09%S%x09%s"]).catch(() => "");
      for (const line of log.split("\n").filter(Boolean)) {
        const [hash, at, ref, subject] = line.split("\t");
        if (seen.has(hash)) continue;
        seen.add(hash);
        const ticket = KEY.exec(subject ?? "")?.[1] ?? KEY.exec(ref ?? "")?.[1];
        if (ticket) out.push({ ticket: ticket.toUpperCase(), at, subject: (subject ?? "").trim() });
      }
    }
  } catch {
    // no repos
  }
  return out;
}

/** The span of a day's commits on a ticket as hours to book: half an hour before the first to the last, in quarters (at most 6 h). */
export function commitSpan(ats: string[]): { start: string; end: string; hours: number } | null {
  const times = ats.map((a) => new Date(a)).filter((d) => !Number.isNaN(d.getTime())).sort((a, b) => a.getTime() - b.getTime());
  if (!times.length) return null;
  const first = times[0];
  const last = times[times.length - 1];
  const hours = Math.min(6, quarter((last.getTime() - first.getTime()) / 3600000 + 0.5));
  return { start: hhmm(new Date(first.getTime() - 30 * 60000)), end: hhmm(last), hours };
}

/** The week drafted for booking, day by day (Monday to today, or the whole week when it is over) — each as proposeDay has it. */
export async function proposeWeek(weekKey?: string | null): Promise<{ key: string; days: DayProposal[] }> {
  const { resolveWeek, currentWeek, isoDate } = await import("@/lib/week");
  const week = resolveWeek(weekKey) ?? currentWeek();
  const today = isoDate(new Date());
  const days: DayProposal[] = [];
  for (const d of week.days.slice(0, 5)) {
    const date = isoDate(d);
    if (date > today) break;
    // An earlier day: as at its end (all its meetings over); today: as now.
    days.push(await proposeDay(date === today ? new Date() : new Date(`${date}T23:59:00`)));
  }
  return { key: week.key, days };
}

/** A line to book, as you left it on the Feierabend page. */
export type DayBooking = { kind: DayRow["kind"]; hours: number; jobNumber: string; description: string; ticket: string | null; externalId?: string; suggestionId?: number; group?: boolean; start?: string; standalone?: boolean };

/** Who books: as on your last booking by hand (else "Me"). */
function reporter(): string {
  const r = getDb().select({ by: schema.timeEntries.reportedBy }).from(schema.timeEntries).where(eq(schema.timeEntries.source, "web")).orderBy(desc(schema.timeEntries.id)).limit(1).get();
  return r?.by && r.by !== "unknown" ? r.by : "Me";
}

/**
 * The day booked as you took it over: meetings as calendar entries (each once — its id), the
 * agents' suggestions accepted (with your hours and words), the tickets as entries of yours.
 * A line that fails is named; the others are booked.
 */
export async function bookDay(date: string, rows: DayBooking[]): Promise<{ booked: number; hours: number; skipped: number; items: number; parallel: number; errors: string[]; created: BookedStamp[] }> {
  const { createEntry } = await import("@/lib/entries");
  const { acceptSuggestion } = await import("@/lib/work/suggestions");
  const { autoGroup, collectIntoHead, collectSpanFor } = await import("@/lib/entry-parallel");
  const { entryRow } = await import("@/lib/entry-spans");
  const by = reporter();
  // items: grouped under the day's collecting entry (a mob day); parallel: grouped with other work done at the same time.
  const out = { booked: 0, hours: 0, skipped: 0, items: 0, parallel: 0, errors: [] as string[], created: [] as BookedStamp[] };
  const ids: number[] = [];
  const count = (g: { mode: string } | null | undefined) => {
    if (!g) return;
    if (g.mode === "collect") out.items++;
    else out.parallel++;
  };
  // The meetings first: a group meeting is the entry the day's other lines are grouped under.
  const ordered = [...rows].sort((a, b) => Number(b.kind === "meeting") - Number(a.kind === "meeting"));
  for (const r of ordered) {
    const what = r.description || r.ticket || t("Line");
    try {
      const hours = Math.round(Number(r.hours) * 100) / 100;
      if (!(hours > 0) || hours > 24) throw new Error(t("Hours: more than 0, at most 24."));
      let entryId: number;
      if (r.kind === "suggestion" && r.suggestionId) {
        const a = acceptSuggestion(r.suggestionId, { hours, description: r.description }, { group: r.standalone ? "none" : undefined });
        entryId = a.entryId;
        count(a.parallel);
      } else {
        // A ticket with no job of its own, on a day with a collecting entry (a mob day): it books on that entry's job.
        let jobNumber = r.jobNumber;
        if (!jobNumber && r.kind === "ticket" && !r.standalone) {
          const c = collectSpanFor(date, { start: r.start, hours });
          jobNumber = (c && getDb().select({ number: schema.jobs.number }).from(schema.jobs).where(eq(schema.jobs.id, entryRow(c.head.id)!.jobId)).get()?.number) || "";
        }
        if (!jobNumber) throw new Error(t("No job chosen."));
        const created = createEntry(
          { jobNumber, date, hours, description: r.description || r.ticket || "Meeting", ticket: r.ticket ?? undefined, reportedBy: by, ...(r.start ? { start: r.start } : {}), ...(r.kind === "meeting" && r.group ? { isGroup: true } : {}) },
          r.kind === "meeting" ? "calendar" : "web",
          r.kind === "meeting" && r.externalId ? { externalId: r.externalId } : {},
        );
        entryId = created.id;
        // A group meeting booked now: what was booked on that day before and runs parallel to it is grouped under it.
        if (r.kind === "meeting" && r.group) out.items += collectIntoHead(created.id);
        // A ticket worked on in parallel (to the day's collecting entry, or to other work of its job): grouped with it.
        else if (r.kind === "ticket" && !r.standalone) count(autoGroup(created.id));
      }
      out.booked++;
      ids.push(entryId);
      out.hours =Math.round((out.hours + (entryRow(entryId)?.hours ?? hours)) * 100) / 100;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // A meeting booked already (its id): not twice.
      if (/UNIQUE constraint failed: time_entries\.external_id/.test(msg)) out.skipped++;
      else out.errors.push(`${what}: ${msg}`);
    }
  }
  // Stamped at the very end (grouping may touch earlier entries while booking): what "untouched" is measured against.
  out.created = ids.flatMap((id) => {
    const row = getDb().select({ updatedAt: schema.timeEntries.updatedAt }).from(schema.timeEntries).where(eq(schema.timeEntries.id, id)).get();
    return row ? [{ id, updatedAt: row.updatedAt }] : [];
  });
  return out;
}

/** An entry a booking created and the moment it was last written — to undo only what is still as booked. */
export type BookedStamp = { id: number; updatedAt: string };

/**
 * Takes a booking back: deletes exactly these entries if they still exist and haven't been edited
 * since (same updatedAt). Anything gone, changed or unknown is left alone and counted as kept.
 */
export async function undoBooking(stamps: BookedStamp[]): Promise<{ deleted: number; kept: number }> {
  const { deleteEntry } = await import("@/lib/entries");
  let deleted = 0;
  let kept = 0;
  // Newest first: tasks of a group go before the head they were grouped under.
  // Checked all up front: deleting a task recalculates its group head, which would make the head look edited.
  const rows = stamps.map((s) => ({ s, row: getDb().select({ updatedAt: schema.timeEntries.updatedAt }).from(schema.timeEntries).where(eq(schema.timeEntries.id, s.id)).get() }));
  for (const { s, row } of rows.sort((a, b) => b.s.id - a.s.id)) {
    if (row && row.updatedAt === s.updatedAt) {
      try {
        deleteEntry(s.id);
        deleted++;
        continue;
      } catch {
        // falls through: kept
      }
    }
    if (row) kept++;
  }
  return { deleted, kept };
}
