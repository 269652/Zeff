import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { EntryType, ReportSettings } from "@/db/schema";
import { listEntries, type EntryWithJob } from "./entries";
import { round2 } from "./format";
import { ValidationError } from "./errors";
import type { TagLite } from "./tags-shared";
import { dedupeTags } from "./tags-shared";
import { isoDate, type WeekInfo } from "./week";

const { reportSettings } = schema;

export type GroupBy = ReportSettings["groupBy"];

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function getReportSettings(): ReportSettings {
  const db = getDb();
  const existing = db.select().from(reportSettings).limit(1).get();
  if (existing) return existing;
  return db.insert(reportSettings).values({ id: 1 }).returning().get();
}

export function updateReportSettings(patch: {
  groupBy?: GroupBy;
  groupMeetingsByDay?: boolean;
  meetingsLabel?: string;
  groupTicketsByDay?: boolean;
  ticketTemplate?: string;
}): ReportSettings {
  const label = patch.meetingsLabel?.trim();
  const tpl = patch.ticketTemplate?.trim();
  if (patch.meetingsLabel !== undefined && !label) {
    throw new ValidationError("The meetings label cannot be empty.");
  }
  if (tpl !== undefined && !tpl.includes("{ticket}") && !tpl.includes("{description}")) {
    throw new ValidationError("The ticket template should contain {ticket} and/or {description}.");
  }
  if (patch.groupBy !== undefined && !["ticket", "type", "tag"].includes(patch.groupBy)) {
    throw new ValidationError(`Unknown grouping "${patch.groupBy}".`);
  }
  getReportSettings();
  return getDb()
    .update(reportSettings)
    .set({
      ...(patch.groupBy !== undefined && { groupBy: patch.groupBy }),
      ...(patch.groupMeetingsByDay !== undefined && { groupMeetingsByDay: patch.groupMeetingsByDay }),
      ...(label !== undefined && { meetingsLabel: label }),
      ...(patch.groupTicketsByDay !== undefined && { groupTicketsByDay: patch.groupTicketsByDay }),
      ...(tpl !== undefined && { ticketTemplate: tpl }),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(reportSettings.id, 1))
    .returning()
    .get();
}

// ---------------------------------------------------------------------------
// Rewritten report
// ---------------------------------------------------------------------------

export type ReportLineEntry = {
  id: number;
  date: string;
  description: string;
  hours: number;
  ticket: string | null;
  type: EntryType;
  tags: TagLite[];
};

export type ReportLine = {
  key: string;
  label: string;
  hours: number;
  type: EntryType;
  ticket: string | null;
  tags: TagLite[];
  count: number;
  /** The individual entries merged into this line (for expansion). */
  entries: ReportLineEntry[];
  /**
   * Whether the line can be expanded to its entries. True for multi-entry lines
   * and for collapsed group labels (Meetings / type / tag) whose label hides the
   * underlying entries even when there is only one.
   */
  expandable: boolean;
};

export type ReportDay = {
  date: string;
  lines: ReportLine[];
  total: number;
};

export type RewrittenReport = {
  week: WeekInfo;
  days: ReportDay[];
  total: number;
  settings: ReportSettings;
  filter: { reportedBy?: string };
};

function applyTicketTemplate(tpl: string, ticket: string | null, description: string): string {
  const label = tpl
    .replaceAll("{ticket}", ticket ?? "")
    .replaceAll("{description}", description)
    .trim();
  return label.replace(/^[:\-–\s]+/, "").trim() || description || ticket || "(untitled)";
}

function unionTags(entries: EntryWithJob[]): TagLite[] {
  const map = new Map<number, TagLite>();
  for (const e of entries) for (const t of e.tags) map.set(t.id, t);
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function primaryTag(e: EntryWithJob): TagLite | undefined {
  return [...e.tags].sort((a, b) => a.name.localeCompare(b.name))[0];
}

/** The group key an entry falls into under the configured grouping. */
function keyOf(e: EntryWithJob, s: ReportSettings): string {
  if (s.groupBy === "type") return `type:${e.type}`;
  if (s.groupBy === "tag") {
    const t = primaryTag(e);
    if (t) return `tag:${t.name.toLowerCase()}`;
    // untagged entries fall back to the ticket-mode grouping
  }
  if (e.type === "meeting") return s.groupMeetingsByDay ? "meetings" : `id:${e.id}`;
  if (e.type === "ticket") {
    return s.groupTicketsByDay ? `ticket:${(e.ticket || e.description).toLowerCase()}` : `id:${e.id}`;
  }
  return `id:${e.id}`;
}

function labelGroup(key: string, entries: EntryWithJob[], s: ReportSettings): { label: string; type: EntryType; ticket: string | null } {
  const first = entries[0];
  if (key.startsWith("type:")) {
    const label = first.type === "meeting" ? s.meetingsLabel : first.type === "ticket" ? "Tickets" : "Other";
    return { label, type: first.type, ticket: null };
  }
  if (key.startsWith("tag:")) {
    return { label: `#${primaryTag(first)?.name ?? ""}`, type: first.type, ticket: null };
  }
  if (key === "meetings") return { label: s.meetingsLabel, type: "meeting", ticket: null };
  if (key.startsWith("ticket:")) {
    const descriptions = dedupeTags(entries.map((e) => e.description).filter(Boolean));
    return {
      label: applyTicketTemplate(s.ticketTemplate, first.ticket, descriptions.join("; ")),
      type: "ticket",
      ticket: first.ticket,
    };
  }
  // individual entry
  const label =
    first.type === "meeting"
      ? first.description || s.meetingsLabel
      : first.type === "ticket"
        ? applyTicketTemplate(s.ticketTemplate, first.ticket, first.description)
        : first.description;
  return { label, type: first.type, ticket: first.ticket };
}

function toLineEntry(e: EntryWithJob): ReportLineEntry {
  return { id: e.id, date: e.date, description: e.description, hours: e.hours, ticket: e.ticket, type: e.type, tags: e.tags };
}

function buildDay(date: string, entries: EntryWithJob[], settings: ReportSettings): ReportDay {
  const groups = new Map<string, EntryWithJob[]>();
  const order: string[] = [];
  for (const e of entries) {
    const key = keyOf(e, settings);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(e);
  }

  const lines: ReportLine[] = order.map((key) => {
    const es = groups.get(key)!;
    const { label, type, ticket } = labelGroup(key, es, settings);
    // Collapsed group labels hide their entries even with one row, so keep them expandable.
    const isCollapsedGroup = key === "meetings" || key.startsWith("type:") || key.startsWith("tag:");
    return {
      key,
      label,
      type,
      ticket,
      hours: round2(es.reduce((a, e) => a + e.hours, 0)),
      tags: unionTags(es),
      count: es.length,
      entries: es.map(toLineEntry),
      expandable: es.length > 1 || isCollapsedGroup,
    };
  });

  lines.sort((a, b) => a.type.localeCompare(b.type) || b.hours - a.hours || a.label.localeCompare(b.label));
  return { date, lines, total: round2(lines.reduce((a, l) => a + l.hours, 0)) };
}

export function getRewrittenReport(week: WeekInfo, filter: { reportedBy?: string } = {}): RewrittenReport {
  const settings = getReportSettings();
  const entries = listEntries({ from: week.startIso, to: week.endIso, reportedBy: filter.reportedBy });

  const byDate = new Map<string, EntryWithJob[]>();
  for (const e of entries) (byDate.get(e.date) ?? byDate.set(e.date, []).get(e.date)!).push(e);

  const days: ReportDay[] = [];
  for (const d of week.days) {
    const iso = isoDate(d);
    const dayEntries = byDate.get(iso);
    if (dayEntries?.length) days.push(buildDay(iso, dayEntries, settings));
  }

  return { week, days, total: round2(days.reduce((a, d) => a + d.total, 0)), settings, filter };
}

/** Plain-text rendering for copy/paste into a timesheet. */
export function reportToText(report: RewrittenReport, formatHours: (h: number) => string): string {
  const lines: string[] = [];
  for (const day of report.days) {
    lines.push(`${day.date}  (${formatHours(day.total)}h)`);
    for (const l of day.lines) {
      const tags = l.tags.length ? " " + l.tags.map((t) => `#${t.name}`).join(" ") : "";
      lines.push(`  - ${l.label}${tags} — ${formatHours(l.hours)}h`);
    }
    lines.push("");
  }
  lines.push(`Total: ${formatHours(report.total)}h`);
  return lines.join("\n");
}
