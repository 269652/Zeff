import { and, desc, eq, gte, isNull, like } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { isInstalled } from "@/plugins/state";

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
  /** Where it comes from, for the line ("10:00–11:00 · Teams", "S-12 · Claude", "T-4 erledigt, Worker 45 min"). */
  from: string;
  /** A meeting's id (no double import), a suggestion's id. */
  externalId?: string;
  suggestionId?: number;
};

export type DayProposal = { date: string; target: number; booked: number; rows: DayRow[]; jobs: { number: string; name: string }[] };

const quarter = (h: number) => Math.max(0.25, Math.round(h * 4) / 4);

/**
 * The day drafted for booking: today's finished meetings not booked yet (with their job by your
 * meeting rules), the agents' open suggestions for today, and the tickets you worked on today
 * (todos done, worker runs) that have no booking yet — a worker's time and line as a start.
 */
export async function proposeDay(now = new Date()): Promise<DayProposal> {
  const { isoDate, currentWeek } = await import("@/lib/week");
  const { listEntries, listBookedOnDates, getJobNumberForTicket } = await import("@/lib/entries");
  const { getDayTargets } = await import("@/lib/schedule");
  const { listJobs } = await import("@/lib/jobs");
  const date = isoDate(now);
  const entries = listEntries({ from: date, to: date });
  const bookedTickets = new Set(entries.map((e) => (e.ticket ?? "").toUpperCase()).filter(Boolean));
  const jobs = listJobs().map((j) => ({ number: j.number, name: j.name }));
  const rows: DayRow[] = [];

  // Today's meetings, as the Calendar tab has them.
  if (isInstalled("outlook-calendar")) {
    const { getCalendarWeek } = await import("@/lib/calendar/week-view");
    const { getMeetingDefaultJob, getMeetingExcludeRules, getMeetingJobRules, getReportSettings } = await import("@/lib/report");
    const settings = getReportSettings();
    const other = getMeetingDefaultJob(settings);
    const week = currentWeek();
    const day = getCalendarWeek(week, {
      now,
      booked: listBookedOnDates(week.days.map(isoDate)),
      excludeRules: getMeetingExcludeRules(settings),
      jobRules: getMeetingJobRules(settings),
      defaultJob: (other && jobs.some((j) => j.number === other) ? other : jobs[0]?.number) ?? "",
    }).find((d) => d.date === date);
    for (const e of day?.events ?? [])
      if (e.state === "importable")
        rows.push({ id: `m:${e.externalId}`, kind: "meeting", include: e.selected, hours: e.hours, jobNumber: e.jobNumber, description: e.subject, ticket: e.ticket ?? null, from: `${e.startTime}–${e.endTime}${e.isTeams ? " · Teams" : ""}`, externalId: e.externalId });
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
      .select({ ticket: schema.todos.ticket, text: schema.todos.text })
      .from(schema.todos)
      .where(and(eq(schema.todos.status, "done"), like(schema.todos.doneAt, `${date}%`)))
      .all();
    const runs = db
      .select({ ticket: schema.workRuns.ticket, durationMs: schema.workRuns.durationMs, entryLine: schema.workRuns.entryLine, summary: schema.workRuns.summary })
      .from(schema.workRuns)
      .where(and(gte(schema.workRuns.startedAt, `${date}T00:00`), isNull(schema.workRuns.entryId)))
      .all();
    const byTicket = new Map<string, { texts: string[]; ms: number; lines: string[] }>();
    const add = (t: string) => byTicket.get(t) ?? byTicket.set(t, { texts: [], ms: 0, lines: [] }).get(t)!;
    for (const d of done) if (d.ticket) add(d.ticket.toUpperCase()).texts.push(d.text);
    for (const r of runs)
      if (r.ticket) {
        const g = add(r.ticket.toUpperCase());
        g.ms += r.durationMs ?? 0;
        if (r.entryLine) g.lines.push(r.entryLine);
      }
    for (const [ticket, g] of byTicket) {
      if (bookedTickets.has(ticket) || suggested.has(ticket)) continue;
      const hours = g.ms ? quarter(g.ms / 3600000) : null;
      const description = (g.lines[0] ?? g.texts[0] ?? "").replace(/\s+/g, " ").slice(0, 120);
      const from = [g.texts.length && `${g.texts.length} Todo${g.texts.length > 1 ? "s" : ""} erledigt`, g.ms && `Worker ${Math.round(g.ms / 60000)} min`].filter(Boolean).join(", ");
      rows.push({ id: `t:${ticket}`, kind: "ticket", include: !!hours, hours, jobNumber: getJobNumberForTicket(ticket) ?? "", description, ticket, from });
    }
  }

  return { date, target: getDayTargets([now])[0]?.target ?? 0, booked: entries.reduce((s, e) => s + e.hours, 0), rows, jobs };
}

/** A line to book, as you left it on the Feierabend page. */
export type DayBooking = { kind: DayRow["kind"]; hours: number; jobNumber: string; description: string; ticket: string | null; externalId?: string; suggestionId?: number };

/** Who books: as on your last booking by hand (else "Ich"). */
function reporter(): string {
  const r = getDb().select({ by: schema.timeEntries.reportedBy }).from(schema.timeEntries).where(eq(schema.timeEntries.source, "web")).orderBy(desc(schema.timeEntries.id)).limit(1).get();
  return r?.by && r.by !== "unknown" ? r.by : "Ich";
}

/**
 * The day booked as you took it over: meetings as calendar entries (each once — its id), the
 * agents' suggestions accepted (with your hours and words), the tickets as entries of yours.
 * A line that fails is named; the others are booked.
 */
export async function bookDay(date: string, rows: DayBooking[]): Promise<{ booked: number; hours: number; skipped: number; errors: string[] }> {
  const { createEntry } = await import("@/lib/entries");
  const { acceptSuggestion } = await import("@/lib/work/suggestions");
  const by = reporter();
  const out = { booked: 0, hours: 0, skipped: 0, errors: [] as string[] };
  for (const r of rows) {
    const what = r.description || r.ticket || "Zeile";
    try {
      const hours = Math.round(Number(r.hours) * 100) / 100;
      if (!(hours > 0) || hours > 24) throw new Error("Stunden: mehr als 0, höchstens 24.");
      if (r.kind === "suggestion" && r.suggestionId) acceptSuggestion(r.suggestionId, { hours, description: r.description });
      else {
        if (!r.jobNumber) throw new Error("Kein Job gewählt.");
        createEntry(
          { jobNumber: r.jobNumber, date, hours, description: r.description || r.ticket || "Termin", ticket: r.ticket ?? undefined, reportedBy: by },
          r.kind === "meeting" ? "calendar" : "web",
          r.kind === "meeting" && r.externalId ? { externalId: r.externalId } : {},
        );
      }
      out.booked++;
      out.hours = Math.round((out.hours + hours) * 100) / 100;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // A meeting booked already (its id): not twice.
      if (/UNIQUE constraint failed: time_entries\.external_id/.test(msg)) out.skipped++;
      else out.errors.push(`${what}: ${msg}`);
    }
  }
  return out;
}
