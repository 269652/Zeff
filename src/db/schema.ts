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
    source: text("source", { enum: ["mcp", "web"] })
      .notNull()
      .default("web"),
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

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type TimeEntry = typeof timeEntries.$inferSelect;
export type NewTimeEntry = typeof timeEntries.$inferInsert;
