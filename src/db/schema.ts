import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
  /** Last "Sync with Chrono": whether Chrono's job search knows this number (null = never checked). */
  chronoFound: integer("chrono_found", { mode: "boolean" }),
  /** Chrono's name for the job, and "client · job group", from that search. */
  chronoName: text("chrono_name"),
  chronoClient: text("chrono_client"),
  chronoCheckedAt: text("chrono_checked_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

/**
 * Projects group entries under a name (e.g. "TYPO3 Training") and book them on the
 * project's job. The job is optional: entries of a project without one sit on the
 * built-in "No job yet" placeholder job (see NO_JOB_NUMBER) until it is set, and move
 * along whenever the project's job changes.
 */
export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull().unique(),
  description: text("description"),
  customer: text("customer"),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "set null" }),
  /** Optional ISO date range the project runs. */
  startDate: text("start_date"),
  endDate: text("end_date"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at")
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
    /** Project the entry is booked under; its job follows the project's job. */
    projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
    /** ISO date, YYYY-MM-DD (local time of the server). */
    date: text("date").notNull(),
    /** Hours as a decimal, e.g. 1.5 = 1h 30m. */
    hours: real("hours").notNull(),
    description: text("description").notNull(),
    /** A note of your own on the entry — kept beside its report text, never part of what is booked. */
    comment: text("comment"),
    /** Kind of work (an entry_types key) — drives report grouping and analysis. */
    type: text("type").notNull().default("other"),
    /** Optional ticket reference, e.g. "PROJ-337". */
    ticket: text("ticket"),
    /** Who reported the time — a person or an agent name. */
    reportedBy: text("reported_by").notNull().default("unknown"),
    /** Where the entry came from. */
    source: text("source", { enum: ["mcp", "web", "calendar"] })
      .notNull()
      .default("web"),
    /** When the work began ("HH:MM", local); null: not known. Its end = start + hours, leaving out the day's breaks — what makes work parallel to a group. */
    start: text("start"),
    /** A group entry (a mob day, or parallel work combined): the work is itemized under it (entry_items) instead of being booked on top. */
    isGroup: integer("is_group", { mode: "boolean" }).notNull().default(false),
    /** collect: its hours are yours (a mob day booked as 8 h) — combine: its hours are what the parallel work spanned, kept up to date from its items. null (a group): collect. */
    groupKind: text("group_kind"),
    /** Entries that ran in parallel and share the span's hours between them (divided): the same key. */
    spanId: text("span_id"),
    /** Divided: the hours really worked on it (its `hours` are its share of the span). */
    workedHours: real("worked_hours"),
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
    index("time_entries_project_idx").on(t.projectId),
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
  /** Default break window(s) on workdays, e.g. "12:00-13:00" (null = none); shown where no break is entered. */
  defaultPauses: text("default_pauses"),
  /** Record the default break in Punch on workdays without an entered break. */
  punchDefaultPauses: integer("punch_default_pauses", { mode: "boolean" }).notNull().default(true),
  /** The flex-time (Gleitzeit) job: a day's missing hours can go there in one click (null = off). */
  flexJobNumber: text("flex_job_number"),
  /** What those bookings say, e.g. "Überstundenabbau" (null = that default). */
  flexComment: text("flex_comment"),
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

/**
 * Breaks taken on a day (e.g. lunch 12:00–12:30), shown in the weekly table's Pause row.
 * Local "HH:MM" times, end after start; a day can have several. Not booked time.
 */
export const pauses = sqliteTable(
  "pauses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    date: text("date").notNull(),
    start: text("start").notNull(),
    end: text("end").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => [index("pauses_date_idx").on(t.date)],
);

/**
 * Entry types (Ticket, Meeting, Training, …) with a display name and color. The built-in
 * keys (ticket, meeting, other, absence, internal) carry meaning — imports, Punch absences —
 * so they can be renamed and recolored but not deleted.
 */
export const entryTypes = sqliteTable("entry_types", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  /** Badge and chart color, "#rrggbb". */
  color: text("color").notNull(),
  sort: integer("sort").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

/**
 * A week's entries as Chrono has them, with their approval status — the last "Pull Chrono"
 * of that week. Matched back to Zeff entries through the report lines the export books.
 */
export const chronoEntries = sqliteTable(
  "chrono_entries",
  {
    /** Chrono's id for the entry. */
    id: text("id").primaryKey(),
    /** Monday of the week it was pulled for. */
    weekStart: text("week_start").notNull(),
    jobNumber: text("job_number").notNull(),
    date: text("date").notNull(),
    hours: real("hours").notNull(),
    comment: text("comment").notNull().default(""),
    /** As Chrono says it: Approved, Submitted, Rejected, … */
    status: text("status").notNull(),
    rejectionComment: text("rejection_comment"),
    /** Who it's waiting for, and who approved it. */
    approver: text("approver"),
    approvedBy: text("approved_by"),
    submittedAt: text("submitted_at"),
    approvedAt: text("approved_at"),
    pulledAt: text("pulled_at").notNull(),
  },
  (t) => [index("chrono_entries_week_idx").on(t.weekStart)],
);

/**
 * Parallel work that belongs together: tasks done at the same time, or under one collecting entry
 * (a mob day). Every task stays an entry of its own with its real hours (`worked_hours`) and its
 * real start — the grouping is never lost. `mode` only says how the span is BOOKED, and that is
 * what the hours of the entries are (reports and exports read them): combine (one spanning entry,
 * the head, carries the span's hours), divide (the span's hours shared between the tasks),
 * sequential (each task its full hours) or collect (a collecting entry of yours, the head, carries
 * the hours). Switching the mode only recalculates booked hours — nothing is rewritten or removed
 * but a head Zeff made itself (`head_auto`).
 */
export const entrySpans = sqliteTable(
  "entry_spans",
  {
    id: text("id").primaryKey(),
    date: text("date").notNull(),
    /** combine | divide | sequential | collect */
    mode: text("mode").notNull(),
    /** The spanning entry (combine: made by Zeff; collect: yours). */
    headId: integer("head_id"),
    headAuto: integer("head_auto", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("entry_spans_date_idx").on(t.date)],
);
export type EntrySpan = typeof entrySpans.$inferSelect;

/** Tags that can be attached to time entries (many-to-many). */
export const tags = sqliteTable("tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  color: text("color"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export const entryTags = sqliteTable(
  "entry_tags",
  {
    entryId: integer("entry_id")
      .notNull()
      .references(() => timeEntries.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.entryId, t.tagId] }),
    index("entry_tags_tag_idx").on(t.tagId),
  ],
);

/**
 * Context behind time entries: a colleague's message, a Teams message or a Jira comment —
 * what was said, by whom, when, and links to it. One item can back several entries.
 */
/**
 * What Punch has on a day, as last read from Punch ("Pull Punch", and right after an export) —
 * for the weekly Booked row's Punch marks. A day read with nothing in Punch has empty lists.
 */
export const punchDays = sqliteTable("punch_days", {
  date: text("date").primaryKey(),
  /** JSON [{ start, end, net }]: Punch's attendance rows (first Kommt, last Geht, net "HH:MM"). */
  work: text("work").notNull().default("[]"),
  /** JSON ["Urlaub", …]: Punch's absences that day. */
  absence: text("absence").notNull().default("[]"),
  pulledAt: text("pulled_at").notNull(),
});

/**
 * Teams messages synced from the Teams web app in the automation Chrome (read from its own
 * local cache): where you were mentioned, and what colleagues wrote you in 1:1 chats (PMs).
 * Pickable as context.
 */
/**
 * Mails from Outlook's inbox, as its list shows them (read in the automation Chrome — none opened):
 * a conversation's latest mail; a new one in it (another preview) is a row of its own.
 */
export const emails = sqliteTable(
  "emails",
  {
    /** "<conversationId>|<hash of sender, subject, preview>". */
    key: text("key").primaryKey(),
    convId: text("conv_id").notNull(),
    /** The folder it was read in ("Posteingang", "Notifications"). */
    folder: text("folder").notNull().default("Posteingang"),
    fromName: text("from_name"),
    fromEmail: text("from_email"),
    subject: text("subject").notNull(),
    /** What the list shows of it (its first lines). */
    preview: text("preview").notNull(),
    /** When it came (to the minute today, the day for older ones). */
    receivedAt: text("received_at").notNull(),
    unread: integer("unread", { mode: "boolean" }).notNull().default(false),
    syncedAt: text("synced_at").notNull(),
    /** Marked done (by hand, or with a todo it led to): no new todos from it. */
    resolvedAt: text("resolved_at"),
    /** Gone through by the Mail-Durchsicht (todos made from it, or nothing to do). */
    reviewedAt: text("reviewed_at"),
    /** WhatsApp: written in a group (null: not known — read before Zeff kept it). */
    isGroup: integer("is_group", { mode: "boolean" }),
    /** WhatsApp, in a group: to you — it mentions you or quotes your message (null: not known). */
    toMe: integer("to_me", { mode: "boolean" }),
    /** The list shows attachments on it (null: not known — read before Zeff looked). */
    hasAttachments: integer("has_attachments", { mode: "boolean" }),
    /** How the driver finds the message again to fetch its attachments (Gmail: msg-f:<id>; Outlook: the item id). */
    attachRef: text("attach_ref"),
  },
  (t) => [index("emails_received_idx").on(t.receivedAt), index("emails_conv_idx").on(t.convId)],
);

/** A plugin installed or not, as you set it (Settings → Plugins) — without a row: its default. */
export const plugins = sqliteTable("plugins", {
  id: text("id").primaryKey(),
  installed: integer("installed", { mode: "boolean" }).notNull(),
  changedAt: text("changed_at").notNull(),
});

/**
 * A booking an agent suggests (MCP report_time, finish_todo): a shadow row until you take it over
 * (then it's a real entry) or skip it. Its evidence: the todos and the work runs that went into it.
 */
export const entrySuggestions = sqliteTable(
  "entry_suggestions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    date: text("date").notNull(),
    hours: real("hours").notNull(),
    /** One line: what was done. */
    description: text("description").notNull(),
    ticket: text("ticket"),
    /** The job it asks for (else the ticket's, when taken over); or a project. */
    jobNumber: text("job_number"),
    projectId: integer("project_id"),
    type: text("type"),
    /** JSON [tag name]. */
    tags: text("tags").notNull().default("[]"),
    reportedBy: text("reported_by").notNull().default("agent"),
    /** JSON [todo id]: the todos the work was on. */
    todoIds: text("todo_ids").notNull().default("[]"),
    /** JSON [work run id]: the runs (with their logs and time) it books. */
    runIds: text("run_ids").notNull().default("[]"),
    /** JSON [todo_time id]: the time records it covers (what the agents reported on the todos). */
    timeIds: text("time_ids").notNull().default("[]"),
    /** open | accepted | skipped */
    status: text("status").notNull().default("open"),
    /** Taken over: the entry it became. */
    entryId: integer("entry_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("entry_suggestions_status_idx").on(t.status)],
);

/**
 * Time reported on a todo: one record per stretch of work (an agent's, through the MCP or a
 * worker's, or yours by hand) — a todo has many. They add up into the booking suggestion of
 * the todos that belong together; booked, they are the entry's evidence.
 */
export const todoTime = sqliteTable(
  "todo_time",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    todoId: integer("todo_id").notNull(),
    minutes: integer("minutes").notNull(),
    /** One line: what was done in that time. */
    note: text("note").notNull().default(""),
    /** Who: the agent's name, or "Du"/"You" by hand. */
    reportedBy: text("reported_by").notNull().default("agent"),
    /** The work run it happened in (an agent's, a worker's). */
    runId: integer("run_id"),
    /** agent | hand */
    source: text("source").notNull().default("agent"),
    /** When the work happened (ISO). */
    at: text("at").notNull(),
    createdAt: text("created_at").notNull(),
    /** The suggestion (S-<id>) that covers it. */
    suggestionId: integer("suggestion_id"),
    /** The entry it was booked into; -1: not to be booked. */
    entryId: integer("entry_id"),
  },
  (t) => [index("todo_time_todo_idx").on(t.todoId)],
);
export type TodoTime = typeof todoTime.$inferSelect;

/**
 * What belongs to a todo, recorded on its own — not derived from its text, operations or runs, and
 * not rewritten when a briefing run rewrites the todo. `branch`: the feature branch its work is on
 * (`value`: the branch name, `repo`: the repo's folder) — its GitLab branch and merge request are
 * context of the todo, always. `dismissed`: a context item (`value`: its ref) taken out by hand —
 * it stays out, whoever cites it again.
 */
export const todoLinks = sqliteTable(
  "todo_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    todoId: integer("todo_id").notNull(),
    /** branch | dismissed */
    kind: text("kind").notNull(),
    value: text("value").notNull(),
    repo: text("repo"),
    /** Who recorded it: run (a worker's or agent's), plan (a delivery), you. */
    source: text("source").notNull().default(""),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("todo_links_unique_idx").on(t.todoId, t.kind, t.value), index("todo_links_todo_idx").on(t.todoId)],
);
export type TodoLink = typeof todoLinks.$inferSelect;

export const teamsMessages = sqliteTable(
  "teams_messages",
  {
    /** "<conversationId>|<messageId>". */
    key: text("key").primaryKey(),
    /** mention | pm */
    kind: text("kind").notNull(),
    /** For mentions: person | tag | team | channel | everyone. */
    mentionType: text("mention_type"),
    conversationId: text("conversation_id").notNull(),
    replyChainId: text("reply_chain_id"),
    messageId: text("message_id").notNull(),
    /** Where it was written: "Team › Channel", a group chat's name, "Chat with …". */
    place: text("place"),
    senderName: text("sender_name"),
    senderId: text("sender_id"),
    /** ISO time it was sent. */
    sentAt: text("sent_at").notNull(),
    subject: text("subject"),
    /** The message as Teams stores it (HTML; only ever shown converted to Markdown). */
    html: text("html").notNull(),
    /** Plain text, for search. */
    text: text("text").notNull(),
    /** "Open in Teams" deep link. */
    link: text("link").notNull(),
    /** Whether Teams has the mention as read (mentions only). */
    isRead: integer("is_read", { mode: "boolean" }),
    syncedAt: text("synced_at").notNull(),
    /** Marked done (by hand, or with a todo it led to): no new todos from it. Kept across syncs. */
    resolvedAt: text("resolved_at"),
  },
  (t) => [index("teams_messages_sent_idx").on(t.sentAt)],
);

/** Jira comments marked done (by hand, or with a todo they led to): Boards runs make no new todos from them. */
export const resolvedJiraComments = sqliteTable("resolved_jira_comments", {
  commentId: text("comment_id").primaryKey(),
  ticket: text("ticket").notNull(),
  resolvedAt: text("resolved_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

/** The Teams sync: how often it runs (minutes, 0 = only by hand) and how the last run went. */
export const teamsSettings = sqliteTable("teams_settings", {
  id: integer("id").primaryKey(),
  syncMinutes: integer("sync_minutes").notNull().default(10),
  lastSyncAt: text("last_sync_at"),
  /** "12 new, 140 in all" or why it didn't run. */
  lastResult: text("last_result"),
  lastOk: integer("last_ok", { mode: "boolean" }),
});

/**
 * GitLab items synced through a GitLab tab in the automation Chrome: merge requests you wrote,
 * are assigned to or review; their comments (yours too); your recent branches. Pickable as
 * context.
 */
export const gitlabItems = sqliteTable(
  "gitlab_items",
  {
    /** "mr:<project>!<iid>", "note:<id>", "branch:<project>:<name>". */
    key: text("key").primaryKey(),
    /** mr | comment | branch */
    kind: text("kind").notNull(),
    /** "group/sub/project". */
    project: text("project").notNull(),
    projectUrl: text("project_url").notNull(),
    /** "!167" (a merge request, or the one a comment is on) or the branch name. */
    ref: text("ref").notNull(),
    /** The merge request's title (also for its comments), or the branch name. */
    title: text("title").notNull(),
    /** Markdown: the description, the comment, or the branch's last commit message. */
    body: text("body").notNull(),
    author: text("author"),
    /** opened / merged / closed (draft · …), resolved / unresolved, or the branch's merge request. */
    state: text("state"),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
    url: text("url").notNull(),
    branch: text("branch"),
    /** A comment's (or branch's) merge request key. */
    parent: text("parent"),
    /** A comment's thread (GitLab's discussion id) — the comments answering each other. */
    thread: text("thread"),
    syncedAt: text("synced_at").notNull(),
    /**
     * A comment marked done here (by hand, or with a todo it led to) — besides GitLab's own
     * "resolved" (`state`): no new todos from it. Kept across syncs.
     */
    resolvedAt: text("resolved_at"),
  },
  (t) => [index("gitlab_items_updated_idx").on(t.updatedAt)],
);

/** The GitLab sync: your GitLab, how often it runs (minutes, 0 = only by hand) and how the last run went. */
export const gitlabSettings = sqliteTable("gitlab_settings", {
  id: integer("id").primaryKey(),
  baseUrl: text("base_url").notNull().default("https://gitlab.com"),
  syncMinutes: integer("sync_minutes").notNull().default(10),
  lastSyncAt: text("last_sync_at"),
  lastResult: text("last_result"),
  lastOk: integer("last_ok", { mode: "boolean" }),
});

export const contexts = sqliteTable("contexts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Where it's from: teams | jira | gitlab | email | note. */
  kind: text("kind").notNull().default("note"),
  /** A short headline (optional — the message's first line stands in). */
  title: text("title"),
  /** Who wrote it, e.g. "Jenny Lehrl". */
  author: text("author"),
  /** The message itself, as pasted. */
  body: text("body").notNull().default(""),
  /** Links to it — the Teams message, the Jira comment, … — as JSON [{ url, label }]. */
  links: text("links").notNull().default("[]"),
  /** When it was written, YYYY-MM-DD. */
  date: text("date"),
  /** The Jira ticket it belongs to (e.g. "PROJ-337") — where "Sync to Jira" posts it. */
  ticket: text("ticket"),
  /** The Jira comment it was posted as, when it was, and what it said then (to spot later edits). */
  jiraCommentId: text("jira_comment_id"),
  jiraSyncedAt: text("jira_synced_at"),
  jiraSyncedHash: text("jira_synced_hash"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

/** Files attached to a context item (screenshots, documents), stored under the data folder. */
export const contextFiles = sqliteTable(
  "context_files",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    contextId: integer("context_id")
      .notNull()
      .references(() => contexts.id, { onDelete: "cascade" }),
    /** The file's own name. */
    name: text("name").notNull(),
    mime: text("mime").notNull().default("application/octet-stream"),
    size: integer("size").notNull().default(0),
    /** Where it's stored, relative to the data folder. */
    path: text("path").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    /** When it was attached to the item's Jira ticket. */
    jiraSyncedAt: text("jira_synced_at"),
  },
  (t) => [index("context_files_context_idx").on(t.contextId)],
);

/** Which context items back which entries (many-to-many), in the order the entry shows them. */
export const entryContexts = sqliteTable(
  "entry_contexts",
  {
    entryId: integer("entry_id")
      .notNull()
      .references(() => timeEntries.id, { onDelete: "cascade" }),
    contextId: integer("context_id")
      .notNull()
      .references(() => contexts.id, { onDelete: "cascade" }),
    /** Its place among the entry's context (dragged into order; new ones go last). */
    position: integer("position").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => [
    primaryKey({ columns: [t.entryId, t.contextId] }),
    index("entry_contexts_context_idx").on(t.contextId),
  ],
);

/** Default tags of a job: added to entries booked on it. */
export const jobTags = sqliteTable(
  "job_tags",
  {
    jobId: integer("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.tagId] })],
);

/** Default tags of a project: added to entries booked on it. */
export const projectTags = sqliteTable(
  "project_tags",
  {
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.tagId] })],
);

/** Default tags of a ticket, by its key (upper-case; synced from Jira or not): added to entries on it. */
export const ticketTags = sqliteTable(
  "ticket_tags",
  {
    ticket: text("ticket").notNull(),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.ticket, t.tagId] })],
);

/**
 * How the weekly report is rewritten for output. One row (id = 1).
 */
export const reportSettings = sqliteTable("report_settings", {
  id: integer("id").primaryKey(),
  /** How entries are grouped per day: by ticket (default), by type, or by tag. */
  groupBy: text("group_by", { enum: ["ticket", "type", "tag"] }).notNull().default("ticket"),
  /** Collapse all Meeting entries on a day into a single line (ticket mode). */
  groupMeetingsByDay: integer("group_meetings_by_day", { mode: "boolean" }).notNull().default(true),
  /** Label for the collapsed meetings line. */
  meetingsLabel: text("meetings_label").notNull().default("Meetings"),
  /** Merge same-ticket entries per day into one line (ticket mode). */
  groupTicketsByDay: integer("group_tickets_by_day", { mode: "boolean" }).notNull().default(true),
  /** Template for a ticket line; {ticket} and {description} are substituted. */
  ticketTemplate: text("ticket_template").notNull().default("{ticket}: {description}"),
  /** JSON array of report-rewriting rules (condition → template). Null = derive from the legacy fields above. */
  rules: text("rules"),
  /** JSON array of meeting→job rules: assign a job to an imported meeting by its title. */
  meetingJobRules: text("meeting_job_rules"),
  /** Job number for imported meetings no meeting→job rule matches (null = the first job). */
  meetingDefaultJob: text("meeting_default_job"),
  /** JSON array of title substrings: imported meetings matching one start unchecked (placeholders, blockers). */
  meetingExcludeRules: text("meeting_exclude_rules"),
  /** JSON array of type rules ({jobNumber, description, type}): infer an entry's type from its job/description. */
  typeRules: text("type_rules"),
  /** JSON map {jobNumber: chronoWorkCode}: force a Chrono WorkCode for a job on export (e.g. Abwesenheit → ABSENCE). */
  chronoWorkcodes: text("chrono_workcodes"),
  /** JSON {startTime,workdayHours,breakMinutes}: the default Punch work day used by the Punch export. */
  punchConfig: text("punch_config"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

/**
 * A local, syncable copy of Jira issues assigned to the user. Populated by the
 * Jira MCP sync (no LLM) or a manual import. Feeds the ticket autocomplete,
 * ticket->job memory, and completion tracking in Analysis.
 */
export const jiraTickets = sqliteTable(
  "jira_tickets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    key: text("key").notNull().unique(),
    summary: text("summary").notNull().default(""),
    /** The ticket's description (plain text as Jira returns it, shortened) — for the ticket hover card. */
    description: text("description"),
    status: text("status").notNull().default(""),
    /** Jira status category: todo | inprogress | done | unknown. */
    statusCategory: text("status_category", { enum: ["todo", "inprogress", "done", "unknown"] })
      .notNull()
      .default("unknown"),
    issueType: text("issue_type"),
    priority: text("priority"),
    assignee: text("assignee"),
    url: text("url"),
    /** Zeff job this ticket is booked on (learned or set on the Jira tab). */
    jobNumber: text("job_number"),
    /** Jira "created" (opened) timestamp, "updated" timestamp, and resolution date when done. */
    openedAt: text("opened_at"),
    updatedAt: text("updated_at"),
    resolvedAt: text("resolved_at"),
    /** First status transition (from the changelog) — a "time to respond" signal. */
    respondedAt: text("responded_at"),
    /** Jira Agile board this ticket belongs to (from board sync); drives the board default job. */
    boardId: integer("board_id"),
    /** Still returned by the last sync (i.e. currently assigned / in scope). */
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    /** Assigned to the current user (vs. a teammate) — set from the assignee=currentUser sync. */
    mine: integer("mine", { mode: "boolean" }).notNull().default(false),
    /**
     * Followed in the Ticket-Lage although not (any more) on the boards' filter: 1 by hand, -1
     * not any more (by hand, over the automatic: recent activity of yours on it), 0 as it comes.
     */
    followed: integer("followed").notNull().default(0),
    syncedAt: text("synced_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => [index("jira_tickets_status_idx").on(t.statusCategory)],
);

/**
 * Jira Agile boards discovered for the projects the synced tickets belong to.
 * A board can be mapped to a Zeff job (`jobNumber`); tickets on that board then
 * default to it. Populated by the board sync (jira_get_agile_boards + members).
 */
export const jiraBoards = sqliteTable("jira_boards", {
  /** The real Jira board id. */
  id: integer("id").primaryKey(),
  name: text("name").notNull().default(""),
  /** kanban | scrum | simple. */
  type: text("type"),
  projectKey: text("project_key"),
  /** Zeff job number this board defaults to (set on the Jira tab). */
  jobNumber: text("job_number"),
  /** Whether this board is synced and feeds the ticket dropdown (curates out stale boards). */
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  /** How many synced tickets are on this board (informational). */
  memberCount: integer("member_count").notNull().default(0),
  syncedAt: text("synced_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

/**
 * How the syncs without a record of their own last went (Jira, Calendar, Chrono, Punch) — for the
 * header's sync menu. Teams, GitLab and the Boards run keep theirs in their own tables.
 */
/**
 * Facts the AI found in your messages — "Nadines Geburtstag: 16.10." — with where they come from
 * (the messages, "mail:<key>"): knowledge of your own, linked to the todos that need it, and
 * exported to the knowledge server. One per subject (a newer one replaces its text).
 */
export const facts = sqliteTable("facts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  subject: text("subject").notNull(),
  text: text("text").notNull(),
  refs: text("refs").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Preferences as JSON, by key — the layout ("layout"), plugins' own settings ("plugin:gmail"). Per account (its database). */
export const prefs = sqliteTable("prefs", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const syncState = sqliteTable("sync_state", {
  key: text("key").primaryKey(),
  lastAt: text("last_at"),
  lastOk: integer("last_ok", { mode: "boolean" }),
  lastMessage: text("last_message"),
  /** How often it runs by itself (minutes, 0: only by hand) — for the steps without settings of their own; null: its default. */
  everyMinutes: integer("every_minutes"),
});

/**
 * App-wide settings (the Settings page): which AI provider runs analyses like the Boards tab's —
 * the Claude Code CLI or GitHub's Copilot CLI — and the model for each ("" = the CLI's own).
 */
export const appSettings = sqliteTable("app_settings", {
  id: integer("id").primaryKey(),
  aiProvider: text("ai_provider").notNull().default("claude"),
  /** Sonnet by default (quick; "" = the CLI's own). */
  claudeModel: text("claude_model").notNull().default("sonnet"),
  copilotModel: text("copilot_model").notNull().default(""),
  /** Luna by default (fast and affordable; "" = the CLI's own). */
  codexModel: text("codex_model").notNull().default("gpt-6-luna"),
  /** Code tab: how many workers run at once. */
  workParallel: integer("work_parallel").notNull().default(2),
  /** Claude Code's permission mode for workers (auto: its classifier decides each action). */
  workPermissionMode: text("work_permission_mode").notNull().default("auto"),
  /** worktree: each code job in a git worktree of its own; checkout: in the repo itself, one job at a time. */
  workIsolation: text("work_isolation").notNull().default("worktree"),
  /** How Copilot workers run: interactive (asks you for permissions on the Code tab), autopilot (allows everything), headless (as a one-shot -p run). */
  workCopilotMode: text("work_copilot_mode").notNull().default("interactive"),
  /** Mail (Outlook's inbox, read in the automation Chrome): every N minutes (0 = only by hand), and how the last sync went. */
  mailSyncMinutes: integer("mail_sync_minutes").notNull().default(15),
  /** The folders read, by name as Outlook lists them, comma-separated. */
  mailFolders: text("mail_folders").notNull().default("Posteingang, Notifications"),
  mailLastSyncAt: text("mail_last_sync_at"),
  mailLastResult: text("mail_last_result"),
  mailLastOk: integer("mail_last_ok", { mode: "boolean" }),
  /** The setup assistant went through (ISO) — a new instance (or account) starts in it until then. */
  setupDoneAt: text("setup_done_at"),
  /** Backups: on (by default), how often (hours), how many kept, where (""= data/backups), the zip's password (""= unencrypted). */
  backupEnabled: integer("backup_enabled", { mode: "boolean" }).notNull().default(true),
  backupEveryHours: integer("backup_every_hours").notNull().default(24),
  /** Unused: the rotation below keeps them since. */
  backupKeep: integer("backup_keep").notNull().default(14),
  /** Kept: the newest of each of the last N days, weeks and months (grandfather-father-son). */
  backupKeepDaily: integer("backup_keep_daily").notNull().default(14),
  backupKeepWeekly: integer("backup_keep_weekly").notNull().default(8),
  backupKeepMonthly: integer("backup_keep_monthly").notNull().default(24),
  /** Each backup also writes the settings and configuration as a config ZIP of their own (importable into any account). */
  backupConfig: integer("backup_config", { mode: "boolean" }).notNull().default(false),
  backupDir: text("backup_dir").notNull().default(""),
  backupPassword: text("backup_password").notNull().default(""),
  backupLastAt: text("backup_last_at"),
  backupLastOk: integer("backup_last_ok", { mode: "boolean" }),
  backupLastResult: text("backup_last_result"),
  /** The LLM plugin's settings (JSON): instructions and context for every prompt and agent, and each task's backend/model. */
  llmSettings: text("llm_settings").notNull().default("{}"),
  /** Unused: repos are set on the Repos page (the repos table) since. */
  workRepos: text("work_repos").notNull().default("[]"),
  /** The workers' model ("" = the AI settings' model for the provider). */
  workModel: text("work_model").notNull().default(""),
  /** Unused: runs have no cost cap (any more). */
  workMaxBudgetUsd: real("work_max_budget_usd").notNull().default(5),
  /** More to tell every worker (house rules), appended to Zeff's own. */
  workInstructions: text("work_instructions").notNull().default(""),
  /** What a todo's label copies for an agent ($todo.id, $todo.ticket, $todo.text filled in): for code todos, and for the others. */
  agentInstructionCode: text("agent_instruction_code").notNull().default("Implement $todo.id using strict TDD in a separate worktree"),
  agentInstructionOther: text("agent_instruction_other").notNull().default("Do $todo.id"),
});

/**
 * The Boards tab: how its runs go — which tickets on the boards chosen on the Jira tab (a JQL
 * filter) and how often it runs by itself (hours; 0 = only by hand). `model`: unused since the
 * AI provider and its model moved to the Settings page (app_settings).
 */
export const boardSettings = sqliteTable("board_settings", {
  id: integer("id").primaryKey(),
  jql: text("jql").notNull().default("assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC"),
  model: text("model").notNull().default(""),
  /** Unused: replaced by autoMinutes. */
  autoHours: integer("auto_hours").notNull().default(0),
  /** How often a run goes by itself, in minutes (0 = only by hand) — on workdays 7–20 h. */
  autoMinutes: integer("auto_minutes").notNull().default(0),
});

/**
 * One run of the Boards tab: the tickets read from Jira (with what Zeff knows about them)
 * gone through the Claude CLI — what happened, what's to do. `tickets`: the facts shown
 * (JSON); `result`: Claude's answer (JSON).
 */
export const boardRuns = sqliteTable(
  "board_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** running | ok | error */
    status: text("status").notNull().default("running"),
    jql: text("jql").notNull(),
    model: text("model"),
    tickets: text("tickets").notNull().default("[]"),
    result: text("result"),
    error: text("error"),
    costUsd: real("cost_usd"),
    durationMs: integer("duration_ms"),
    startedAt: text("started_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    finishedAt: text("finished_at"),
  },
  (t) => [index("board_runs_started_idx").on(t.startedAt)],
);

/**
 * The Recap on the Todos tab: what you did on a day, gathered (Zeff entries, todos done,
 * workers' runs, your Jira comments and changes, commits, GitLab) and written up by the AI —
 * a summary and, per ticket, what was done. `facts`: what it was given, by ticket.
 */
export const dayRecaps = sqliteTable(
  "day_recaps",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** The day it's about, YYYY-MM-DD (local). */
    day: text("day").notNull(),
    /** running | ok | error */
    status: text("status").notNull().default("running"),
    model: text("model"),
    facts: text("facts").notNull().default("{}"),
    result: text("result"),
    error: text("error"),
    costUsd: real("cost_usd"),
    durationMs: integer("duration_ms"),
    startedAt: text("started_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    finishedAt: text("finished_at"),
  },
  (t) => [index("day_recaps_day_idx").on(t.day)],
);

/**
 * A concrete todo on a ticket, as a board run found it (or kept it) — referenced as T-<id>,
 * also by agents (Zeff's MCP server). `owner`: me | other (someone else's move);
 * `status`: open | done | dismissed.
 */
export const todos = sqliteTable(
  "todos",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ticket: text("ticket").notNull(),
    text: text("text").notNull(),
    kind: text("kind").notNull().default("other"),
    owner: text("owner").notNull().default("me"),
    status: text("status").notNull().default("open"),
    /** What it rests on: a Jira comment, a change, a Teams message… (as the run said). */
    source: text("source"),
    /** The comments and messages it came from (JSON: "jira-comment:<id>", "teams:<key>") — done, they're done too. */
    refs: text("refs").notNull().default("[]"),
    /** Why it was closed (a run's reason, or yours). */
    note: text("note"),
    /** The run that last found it still to do. */
    runId: integer("run_id"),
    /** A message ready to send (a comment, a reply) or a change to make (status → Testing) — a follow-up's. */
    draft: text("draft"),
    /** Where it goes: jira | teams | gitlab (null: it's work, not a message). */
    channel: text("channel"),
    /** What it goes to: a ticket key, "teams:<key>", "gitlab:note:<id>". */
    target: text("target"),
    /** The todo it follows up on. */
    parentId: integer("parent_id"),
    /** The work run that left it (a follow-up), or that drafted its message. */
    workRunId: integer("work_run_id"),
    /** The time entry it was booked into (Weekly report's "Done today"); -1: not to be booked. */
    entryId: integer("entry_id"),
    /** JSON [TodoOp]: what doing it takes, as operations Zeff runs itself (a transition, an assignee, a comment, a GitLab reply or resolve). */
    ops: text("ops").notNull().default("[]"),
    /**
     * JSON [{ path, steps }]: what comes after it, planned (the Ticket-Lage's) — when it's done,
     * each path's first step becomes a todo carrying the rest. Several paths: alternatives
     * (a merge request or straight to main) — doing one drops the others.
     */
    planned: text("planned").notNull().default("[]"),
    /** The alternative path it's on (its siblings on other paths are dropped once it's done). */
    path: text("path"),
    /** An agent working on it waits for your answer: its question (cleared when it goes on). */
    needsInput: text("needs_input"),
    /** JSON [{ at, text }]: your notes on it — context for the Ticket-Lage, workers and agents. */
    userNotes: text("user_notes").notNull().default("[]"),
    /** Put to the bottom by you, then: it comes back up after a while, or when something new happens on it. */
    deferredAt: text("deferred_at"),
    /** Flagged important by you: at the top of its list, urgent for the Ticket-Lage — till you take the flag off. */
    flaggedAt: text("flagged_at"),
    /** JSON { at, by, note }: a worker (or agent) says it's done — the todo stays open and is highlighted, until you close it. */
    workerDone: text("worker_done"),
    /** JSON [ticket key]: other tickets it's about too (the same thing on two tickets) — `ticket` is the main one, the original. */
    alsoTickets: text("also_tickets").notNull().default("[]"),
    /** JSON ["mail:<key>"]: the mails it's about — picked by the mail relation run (after the Ticket-Lage), its own say. */
    mailRefs: text("mail_refs").notNull().default("[]"),
    /** When the auto-actions review last went through it (it's looked at again once it changes). */
    actionsReviewedAt: text("actions_reviewed_at"),
    /** Its operations came from the auto-actions review: why they fit (null: from the Lage, a worker, you). */
    autoOpsWhy: text("auto_ops_why"),
    /** When it's due (YYYY-MM-DD) — a deadline the AI found, or set by you. */
    due: text("due"),
    /** JSON: the knowledge the Wissens-Zuordnung picked for it ({ at, pages, entities }). */
    knowledge: text("knowledge"),
    /** A worker made it (a run's follow-up): it lives on the Todos page's "Worker" tab, not in your list — and a worker may close it. */
    byWorker: integer("by_worker", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    doneAt: text("done_at"),
    /** Set: this todo was a duplicate and went into that one (the oldest keeps its id) - it is closed (dismissed) and every reference follows the survivor. */
    mergedInto: integer("merged_into"),
    /** When this todo last absorbed a duplicate: it counts as new again (the blue highlight) from then on. */
    mergedAt: text("merged_at"),
  },
  (t) => [index("todos_ticket_idx").on(t.ticket), index("todos_status_idx").on(t.status), index("todos_merged_into_idx").on(t.mergedInto)],
);

/**
 * What happened to the todos — each one made, done, dropped or opened again, written by triggers
 * on todos (so no way of closing one goes unrecorded), who did it filled in by Zeff where it knows.
 */
export const todoEvents = sqliteTable(
  "todo_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    todoId: integer("todo_id").notNull(),
    /** created | done | dismissed | reopened | merged (a duplicate went into the todo, or the todo went into another) */
    event: text("event").notNull(),
    fromStatus: text("from_status"),
    /** The todo as it was then. */
    ticket: text("ticket").notNull(),
    text: text("text").notNull(),
    /** Why: the closing note, or where a new one came from. */
    note: text("note"),
    /** Who: "lage:<boardRunId>", "work:<workRunId>", "you", "agent:<name>", "jira", "plan" (null: not known). */
    actor: text("actor"),
    boardRunId: integer("board_run_id"),
    workRunId: integer("work_run_id"),
    at: text("at").notNull(),
  },
  (t) => [index("todo_events_todo_idx").on(t.todoId), index("todo_events_at_idx").on(t.at)],
);

/**
 * A code repository workers implement in (Code tab): its folder on this machine, the GitLab
 * project it is, the Jira boards — and single tickets — whose work goes there, and what its
 * workers should know (test commands, conventions).
 */
export const repos = sqliteTable("repos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  path: text("path").notNull(),
  /** "group/sub/project", as the GitLab sync knows it. */
  gitlabProject: text("gitlab_project"),
  /** JSON [boardId]: the Jira boards whose tickets are worked on here. */
  boards: text("boards").notNull().default("[]"),
  /** JSON ["PROJ-321"]: single tickets worked on here (before their board's repo). */
  tickets: text("tickets").notNull().default("[]"),
  instructions: text("instructions").notNull().default(""),
  /** How finished work gets in: mr (push a feature branch, open a merge request, merge once approved) | direct (merge into the default branch and push). */
  delivery: text("delivery").notNull().default("mr"),
  /** JSON ["old/branch"]: local branches not to list as work (Code tab's Branches). */
  ignoredBranches: text("ignored_branches").notNull().default("[]"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

/** Jira comments as the Ticket-Lage runs read them — kept, so a todo's sources show them later too. */
export const jiraComments = sqliteTable(
  "jira_comments",
  {
    id: text("id").primaryKey(),
    ticket: text("ticket").notNull(),
    author: text("author").notNull().default(""),
    at: text("at").notNull().default(""),
    body: text("body").notNull().default(""),
  },
  (t) => [index("jira_comments_ticket_idx").on(t.ticket)],
);

/**
 * A change to a ticket made with a click on the Todos tab, as a run suggested it (a transition,
 * an assignee, a comment) — what, from which run, when, and how it went. `status`: done | failed.
 */
export const ticketActions = sqliteTable(
  "ticket_actions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id").notNull(),
    ticket: text("ticket").notNull(),
    /** Its place in the run's list for the ticket. */
    idx: integer("idx").notNull(),
    type: text("type").notNull(),
    label: text("label").notNull(),
    /** JSON: the action as the run suggested it. */
    action: text("action").notNull(),
    status: text("status").notNull(),
    /** What happened in Jira, or why it didn't. */
    detail: text("detail"),
    at: text("at").notNull(),
  },
  (t) => [index("ticket_actions_run_idx").on(t.runId)],
);

/**
 * The Code tab: a todo handed to a worker (Claude Code or Copilot CLI, unattended) — and all it
 * did: the prompt it got, where it worked (repo, worktree, branch), its session, its log (a
 * file under data/work/), its answer, what git says it changed, what it cost, how long it took,
 * and the time entry its time went into. `mode`: code (do the work) | draft (write the message)
 * | send (post the drafted message). `status`: queued | running | done | failed | cancelled |
 * interrupted.
 */
export const workRuns = sqliteTable(
  "work_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ticket: text("ticket").notNull(),
    /** The todo it's about. */
    todoId: integer("todo_id").notNull(),
    mode: text("mode").notNull(),
    provider: text("provider").notNull(),
    model: text("model"),
    permissionMode: text("permission_mode"),
    status: text("status").notNull().default("queued"),
    /** The repo (by the ticket's prefix), and where it ran: the repo, its worktree, or a scratch folder. */
    repo: text("repo"),
    cwd: text("cwd"),
    /** The worktree's branch, and what it started from (ref and commit). */
    branch: text("branch"),
    base: text("base"),
    baseSha: text("base_sha"),
    sessionId: text("session_id"),
    /** Your message sent while the run before it (in the same session) still worked: it starts when that run has ended, and goes on with its conversation. */
    afterRun: integer("after_run"),
    pid: integer("pid"),
    prompt: text("prompt").notNull(),
    /** Its answer (JSON: outcome, summary, entry, completedTodos, followUps, changes, checks, draft). */
    result: text("result"),
    /** done | partial | blocked — as it said. */
    outcome: text("outcome"),
    summary: text("summary"),
    /** One line for the time entry. */
    entryLine: text("entry_line"),
    /** Commits and changed files, as git saw them at the end. */
    gitSummary: text("git_summary"),
    error: text("error"),
    /** Its error seen and put away (no longer shown on the todo). */
    errorSeenAt: text("error_seen_at"),
    costUsd: real("cost_usd"),
    durationMs: integer("duration_ms"),
    turns: integer("turns"),
    /** Where it works, as chosen with the session: "worktree" (a new branch from `base`, own folder), "branch" (the existing branch `base`, own folder), "checkout" (in the repo itself); null: the Code settings' isolation. */
    workspace: text("workspace"),
    /** Actions the permission mode refused. */
    denials: integer("denials"),
    /** The time entry its time went into (Weekly report). */
    entryId: integer("entry_id"),
    queuedAt: text("queued_at").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
  },
  (t) => [index("work_runs_todo_idx").on(t.todoId), index("work_runs_status_idx").on(t.status)],
);

/**
 * The Google Drive plugin's connection (one row, id 1; per account): your own OAuth client, the
 * tokens it got, and how the syncs behave. What it does is off until you set it up and connect.
 */
export const googleDrive = sqliteTable("google_drive", {
  id: integer("id").primaryKey(),
  clientId: text("client_id").notNull().default(""),
  clientSecret: text("client_secret").notNull().default(""),
  refreshToken: text("refresh_token").notNull().default(""),
  accessToken: text("access_token").notNull().default(""),
  /** Access token expiry as epoch milliseconds. */
  expiresAt: integer("expires_at").notNull().default(0),
  /** What Google granted: "drive.file" (only files Zeff made) or full Drive access (to read files you add). */
  scope: text("scope").notNull().default(""),
  email: text("email").notNull().default(""),
  connectedAt: text("connected_at"),
  /** The Drive folder Zeff keeps things in ("" = Zeff's own name for it); its subfolders' ids once made. */
  folderName: text("folder_name").notNull().default(""),
  rootFolderId: text("root_folder_id").notNull().default(""),
  backupsFolderId: text("backups_folder_id").notNull().default(""),
  documentsFolderId: text("documents_folder_id").notNull().default(""),
  /** Backups: what the local retention removes goes from Drive too. */
  mirrorBackupRetention: integer("mirror_backup_retention", { mode: "boolean" }).notNull().default(true),
  /** Backups: also those without a password (the whole database, readable by anyone with the file). */
  uploadUnencrypted: integer("upload_unencrypted", { mode: "boolean" }).notNull().default(false),
  /** Documents: files you add to the Drive folder come to Zeff (needs full Drive access) — off by default. */
  pullDocuments: integer("pull_documents", { mode: "boolean" }).notNull().default(false),
});

/** What of Zeff's is in Drive: a backup file, a document — and the Drive file it is. */
export const googleDriveFiles = sqliteTable(
  "google_drive_files",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** "backup" (key: the file's name) or "document" (key: "doc:<id>"). */
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    driveId: text("drive_id").notNull(),
    /** Drive's version of it: the content's md5, else its modified time (a Google Doc). */
    version: text("version").notNull().default(""),
    size: integer("size").notNull().default(0),
    /** Where it came from: pushed (Zeff → Drive) or pulled (Drive → Zeff). */
    origin: text("origin").notNull().default("push"),
    syncedAt: text("synced_at").notNull(),
  },
  (t) => [uniqueIndex("google_drive_files_drive").on(t.driveId), index("google_drive_files_key").on(t.kind, t.key)],
);


export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type TimeEntry = typeof timeEntries.$inferSelect;
export type NewTimeEntry = typeof timeEntries.$inferInsert;
/** An entry_types key, e.g. "ticket" or "training". */
export type EntryType = string;
export type EntryTypeRow = typeof entryTypes.$inferSelect;
export type CalendarConnection = typeof calendarConnections.$inferSelect;
export type GoogleDriveRow = typeof googleDrive.$inferSelect;
export type WorkSchedule = typeof workSchedule.$inferSelect;
export type Absence = typeof absences.$inferSelect;
export type Pause = typeof pauses.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type Context = typeof contexts.$inferSelect;
export type ContextFile = typeof contextFiles.$inferSelect;
export type ReportSettings = typeof reportSettings.$inferSelect;
export type JiraTicket = typeof jiraTickets.$inferSelect;
export type JiraStatusCategory = JiraTicket["statusCategory"];
export type JiraBoard = typeof jiraBoards.$inferSelect;
export type TeamsMessage = typeof teamsMessages.$inferSelect;
export type TeamsSettings = typeof teamsSettings.$inferSelect;
export type GitlabItem = typeof gitlabItems.$inferSelect;
export type GitlabSettings = typeof gitlabSettings.$inferSelect;
export type AppSettings = typeof appSettings.$inferSelect;
export type BoardSettings = typeof boardSettings.$inferSelect;
export type BoardRun = typeof boardRuns.$inferSelect;
export type Todo = typeof todos.$inferSelect;
export type Repo = typeof repos.$inferSelect;
export type TicketActionRow = typeof ticketActions.$inferSelect;
/**
 * A finished run's report (Code tab): what it did, what it changed and checked, what is open, where
 * it lies — kept whole (the comment on the todo is cut short), per run, filed under the todo it
 * worked on and listing the todos it reported done. The knowledge server reads these (Zeff · Berichte).
 */
export const workReports = sqliteTable(
  "work_reports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** The run it came from — one report per run (a later answer of the same run replaces it). */
    runId: integer("run_id").notNull(),
    todoId: integer("todo_id").notNull(),
    ticket: text("ticket").notNull(),
    /** done | partial | blocked — as the run said. */
    outcome: text("outcome").notNull(),
    /** One line: the run's entry line. */
    title: text("title").notNull(),
    /** The run's own summary. */
    summary: text("summary").notNull(),
    /** The whole report as Markdown (summary + changes, checks, what is open, where it lies). */
    body: text("body").notNull(),
    /** JSON: string[] (changed files/commits), string[] (checks with results), string[] (the follow-ups' texts), number[] (the todos it reported done). */
    changes: text("changes"),
    checks: text("checks"),
    openItems: text("open_items"),
    completedTodos: text("completed_todos"),
    repo: text("repo"),
    branch: text("branch"),
    /** Who wrote it: "W-45 · model". */
    byWho: text("by_who").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("work_reports_run_idx").on(t.runId), index("work_reports_todo_idx").on(t.todoId)],
);
export type WorkReport = typeof workReports.$inferSelect;

export type WorkRun = typeof workRuns.$inferSelect;
export type EntrySuggestion = typeof entrySuggestions.$inferSelect;

/** Kanban (Kanban plugin): your own boards — a Jira of your own for projects, private or work. */
export const kanbanBoards = sqliteTable("kanban_boards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  color: text("color").notNull().default("indigo"),
  sort: integer("sort").notNull().default(0),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  /** Its cards go into the Ticket-Lage (as KB-<id>): todos, the Lage per card, the reports. */
  inLage: integer("in_lage", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

/** A board's columns, in order; `done`: a card there counts as done. */
export const kanbanColumns = sqliteTable(
  "kanban_columns",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    boardId: integer("board_id")
      .notNull()
      .references(() => kanbanBoards.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sort: integer("sort").notNull().default(0),
    wipLimit: integer("wip_limit"),
    done: integer("done", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("kanban_columns_board").on(t.boardId)],
);

/** A card (K-<id>): in a column, in order (`sort`), with labels, a priority, a due day. */
export const kanbanCards = sqliteTable(
  "kanban_cards",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    boardId: integer("board_id")
      .notNull()
      .references(() => kanbanBoards.id, { onDelete: "cascade" }),
    columnId: integer("column_id")
      .notNull()
      .references(() => kanbanColumns.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    labels: text("labels").notNull().default("[]"),
    priority: text("priority"),
    due: text("due"),
    /** Who's on it (a name — the board's person filter). */
    assignee: text("assignee"),
    sort: real("sort").notNull().default(0),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    /** The card it is a subtask of (same board; one level): it sits in a column of its own, linked to its parent. */
    parentId: integer("parent_id"),
    createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
    doneAt: text("done_at"),
  },
  (t) => [index("kanban_cards_column").on(t.columnId, t.sort)],
);

/**
 * Calendars (the Kalender app) — Zeff's model of every calendar ("IR"): its own, and those of a
 * source (Google Calendar, Outlook), each source's adapter writing into it; the app, free times and
 * booking read only this. Each
 * with its colour, shown or not, counted as busy or not. `key`: "zeff:<id>", "google:<calendar id>",
 * "outlook".
 */
export const calendars = sqliteTable(
  "calendars",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    key: text("key").notNull(),
    source: text("source", { enum: ["zeff", "google", "outlook"] }).notNull(),
    name: text("name").notNull(),
    color: text("color").notNull(),
    visible: integer("visible", { mode: "boolean" }).notNull().default(true),
    /** Its appointments block time (free-time search, appointment proposals) — not birthdays, say. */
    busy: integer("busy", { mode: "boolean" }).notNull().default(true),
    /** Its meetings are offered for booking (Zeiterfassung's Kalender) — Outlook's by default. */
    book: integer("book", { mode: "boolean" }).notNull().default(false),
    /** Its appointments become todos on their day (Zeff's own calendars by default). */
    todos: integer("todos", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("calendars_key").on(t.key)],
);

/** A calendar's appointments: local times "YYYY-MM-DDTHH:MM" (all-day: the days, end exclusive). `key`: the source's id. */
export const calendarEvents = sqliteTable(
  "calendar_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    calendarId: integer("calendar_id").notNull(),
    key: text("key").notNull(),
    title: text("title").notNull(),
    start: text("start").notNull(),
    end: text("end").notNull(),
    allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
    location: text("location").notNull().default(""),
    description: text("description").notNull().default(""),
    /** busy | free | tentative | oof | workingElsewhere (Outlook's words). */
    showAs: text("show_as").notNull().default("busy"),
    cancelled: integer("cancelled", { mode: "boolean" }).notNull().default(false),
    /** Your answer to an invitation: accepted | declined | tentativelyAccepted | notResponded | organizer. */
    response: text("response"),
    private: integer("private", { mode: "boolean" }).notNull().default(false),
    online: integer("online", { mode: "boolean" }).notNull().default(false),
    organizer: text("organizer").notNull().default(""),
    /** JSON: the attendees' names or addresses. */
    attendees: text("attendees").notNull().default("[]"),
    /** Where it opens in its source (Outlook's webLink …). */
    url: text("url").notNull().default(""),
    /** The source's own record (Outlook's event, JSON) — what its own features read, unchanged. */
    raw: text("raw"),
    /** The todo it was made for (an appointment proposed by the auto-actions). */
    todoId: integer("todo_id"),
    /** A series (Zeff's own calendars): its rule (JSON, recurrence.ts) on its first appointment — expanded when read. */
    recurrence: text("recurrence"),
    /** A series' occurrences left out (moved or deleted one by one): their days, JSON. */
    exdates: text("exdates").notNull().default("[]"),
    /** An occurrence changed on its own: the series it came from. */
    seriesId: integer("series_id"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("calendar_events_key").on(t.calendarId, t.key), index("calendar_events_start").on(t.start)],
);

/**
 * Mail attachments taken into the Documents store (src/lib/mail/attachments-sync.ts): one row per
 * attachment of a mail — also the "seen already" list, so a sync never fetches the same one twice.
 * status: done (a document, `docId`) | skipped (the rules said no, `error` says why) | failed
 * (retried a few times) | none (a mail the list flagged but that has nothing to take; att_key "").
 */
export const mailAttachments = sqliteTable(
  "mail_attachments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** outlook | gmail */
    source: text("source").notNull(),
    /** emails.key */
    mailKey: text("mail_key").notNull(),
    /** "<name>|<size>" — what identifies an attachment of a mail across fetches. */
    attKey: text("att_key").notNull(),
    name: text("name").notNull().default(""),
    mime: text("mime").notNull().default(""),
    size: integer("size").notNull().default(0),
    docId: integer("doc_id"),
    status: text("status").notNull(),
    error: text("error").notNull().default(""),
    tries: integer("tries").notNull().default(0),
    fetchedAt: text("fetched_at").notNull(),
  },
  (t) => [uniqueIndex("mail_attachments_key").on(t.source, t.mailKey, t.attKey), index("mail_attachments_doc").on(t.docId)],
);

/**
 * Documents (the Documents plugin): files you dropped — text, office files, PDFs, pictures, audio —
 * kept on disk (`file`, in the account's documents folder), their text extracted (`text`) and, once
 * the knowledge server compiled them, their abstract (`summary`). One per content (`sha256`).
 */
export const documents = sqliteTable(
  "documents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    mime: text("mime").notNull().default(""),
    size: integer("size").notNull().default(0),
    sha256: text("sha256").notNull(),
    /** text | office | pdf | image | audio | other */
    kind: text("kind").notNull().default("other"),
    /** queued | extracting | ready | failed | unsupported */
    status: text("status").notNull().default("queued"),
    error: text("error").notNull().default(""),
    /** The stored file's name inside the documents folder. */
    file: text("file").notNull(),
    text: text("text").notNull().default(""),
    summary: text("summary").notNull().default(""),
    concepts: text("concepts").notNull().default(""),
    /** The knowledge server compiled it (its abstract is `summary`). */
    compiled: integer("compiled", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("documents_sha256").on(t.sha256)],
);

/**
 * How Zeff talks to a service (one row each): through the automation Chrome ("cdp", the default —
 * what you're signed in with there) or the service's own API ("api", with a token or an OAuth
 * sign-in of your own). Server only.
 */
export const connectors = sqliteTable("connectors", {
  service: text("service").primaryKey(),
  /** cdp | api */
  driver: text("driver").notNull().default("cdp"),
  /** How the API is signed in to: token (a personal access token) | oauth. */
  authKind: text("auth_kind").notNull().default("token"),
  token: text("token").notNull().default(""),
  clientId: text("client_id").notNull().default(""),
  clientSecret: text("client_secret").notNull().default(""),
  accessToken: text("access_token").notNull().default(""),
  refreshToken: text("refresh_token").notNull().default(""),
  /** Access token expiry as epoch milliseconds. */
  expiresAt: integer("expires_at").notNull().default(0),
  scope: text("scope").notNull().default(""),
  /** Who is signed in (to show it). */
  account: text("account").notNull().default(""),
  connectedAt: text("connected_at"),
  /** Per provider: more settings as JSON (Microsoft: { tenant }). */
  extra: text("extra").notNull().default("{}"),
});
export type ConnectorRow = typeof connectors.$inferSelect;
