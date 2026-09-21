import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Jobs (Aufträge) — every time entry is booked against a job number.
 */
export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Human-facing job number, e.g. "2026-0815" or "PROJ-PROJ". Unique. */
  number: text("number").notNull().unique(),
  name: text("name").notNull(),
  customer: text("customer"),
  description: text("description"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

/**
 * Time entries (Zeiteinträge) — hours booked on a job for a given day.
 */
export const timeEntries = sqliteTable(
  "time_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "restrict" }),
    /** ISO date, YYYY-MM-DD (local time of the server). */
    date: text("date").notNull(),
    /** Hours as a decimal, e.g. 1.5 = 1h 30m. */
    hours: real("hours").notNull(),
    description: text("description").notNull(),
    /** Optional ticket reference, e.g. "PROJ-337". */
    ticket: text("ticket"),
    /** Who reported the time — a person or an agent name. */
    reportedBy: text("reported_by").notNull().default("unknown"),
    /** Where the entry came from. */
    source: text("source", { enum: ["mcp", "web", "calendar"] })
      .notNull()
      .default("web"),
    /** Id of the calendar event an imported entry was created from (prevents double imports). */
    externalId: text("external_id").unique(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => [
    index("time_entries_date_idx").on(t.date),
    index("time_entries_job_idx").on(t.jobId),
  ],
);

/**
 * OAuth connection to a calendar provider (currently Microsoft Graph). Zeff is a
 * single-user tool, so there is at most one row per provider.
 */
export const calendarConnections = sqliteTable("calendar_connections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider").notNull().unique(),
  accountName: text("account_name"),
  accountEmail: text("account_email"),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  /** Access token expiry as epoch milliseconds. */
  expiresAt: integer("expires_at").notNull(),
  scope: text("scope"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

/**
 * The recurring weekly working pattern: expected hours per weekday. One row
 * (id = 1). Part-time is expressed by lowering or zeroing a weekday — e.g.
 * "free every Friday" sets `fri` to 0.
 */
export const workSchedule = sqliteTable("work_schedule", {
  id: integer("id").primaryKey(),
  mon: real("mon").notNull().default(8),
  tue: real("tue").notNull().default(8),
  wed: real("wed").notNull().default(8),
  thu: real("thu").notNull().default(8),
  fri: real("fri").notNull().default(8),
  sat: real("sat").notNull().default(0),
  sun: real("sun").notNull().default(0),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

/**
 * One-off absences (vacation, sick, holiday, …) over an inclusive date range.
 * An absence lowers a day's target hours (by `hours` if set, otherwise the
 * whole day).
 */
export const absences = sqliteTable(
  "absences",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    type: text("type", { enum: ["vacation", "sick", "holiday", "other"] })
      .notNull()
      .default("vacation"),
    /** Hours removed per covered day; null = the whole day is off. */
    hours: real("hours"),
    note: text("note"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => [index("absences_range_idx").on(t.startDate, t.endDate)],
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type TimeEntry = typeof timeEntries.$inferSelect;
export type NewTimeEntry = typeof timeEntries.$inferInsert;
export type CalendarConnection = typeof calendarConnections.$inferSelect;
export type WorkSchedule = typeof workSchedule.$inferSelect;
export type Absence = typeof absences.$inferSelect;
