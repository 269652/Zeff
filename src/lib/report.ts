import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { EntryType, ReportSettings } from "@/db/schema";
import { listEntries, type EntryWithJob } from "./entries";
import { round2 } from "./format";
import { ValidationError } from "./errors";
import {
  defaultRules,
  matchedRule,
  parseRules,
  reportGroupKey,
  reportGroupLabel,
  validateRules,
  type ReportRule,
  type RuleEntry,
} from "./report-shared";
import type { TagLite } from "./tags-shared";
import { isoDate, type WeekInfo } from "./week";

const { reportSettings } = schema;

export type GroupBy = ReportSettings["groupBy"];

/**
 * The active rewriting rules: the stored JSON rules, else rules derived from the
 * legacy group_by / meetings-label / ticket-template columns (so existing setups
 * keep working until the user saves new rules).
 */
export function getReportRules(s: ReportSettings): ReportRule[] {
  const stored = parseRules(s.rules);
  if (stored.length) return stored;
  const rules: ReportRule[] = [];
  if (s.groupMeetingsByDay) rules.push({ id: "meetings", field: "type", value: "meeting", template: s.meetingsLabel || "Meetings" });
  rules.push({ id: "tickets", field: "type", value: "ticket", template: s.ticketTemplate || "{ticket}: {desc}" });
  rules.push({ id: "rest", field: "always", value: "", template: "{desc}" });
  return rules.length ? rules : defaultRules();
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function getReportSettings(): ReportSettings {
  const db = getDb();
  const existing = db.select().from(reportSettings).limit(1).get();
  if (existing) return existing;
  return db.insert(reportSettings).values({ id: 1 }).returning().get();
}

export function updateReportSettings(patch: { rules?: ReportRule[] }): ReportSettings {
  if (patch.rules !== undefined) {
    const err = validateRules(patch.rules);
    if (err) throw new ValidationError(err);
  }
  getReportSettings();
  return getDb()
    .update(reportSettings)
    .set({
      ...(patch.rules !== undefined && { rules: JSON.stringify(patch.rules) }),
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

function unionTags(entries: EntryWithJob[]): TagLite[] {
  const map = new Map<number, TagLite>();
  for (const e of entries) for (const t of e.tags) map.set(t.id, t);
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function toLineEntry(e: EntryWithJob): ReportLineEntry {
  return { id: e.id, date: e.date, description: e.description, hours: e.hours, ticket: e.ticket, type: e.type, tags: e.tags };
}

/** Flatten an entry into the shape the rules match on (job number/name lifted up). */
function toRuleEntry(e: EntryWithJob): RuleEntry {
  return { type: e.type, ticket: e.ticket, description: e.description, tags: e.tags, jobNumber: e.job.number, jobName: e.job.name };
}

/**
 * Group a day's entries by the label their first matching rule renders — entries
 * that render to the same label merge (hours summed). A line stays expandable when
 * it merges several entries, or when its label rewrites a single entry's text.
 */
function buildDay(date: string, entries: EntryWithJob[], rules: ReportRule[]): ReportDay {
  const groups = new Map<string, { rule: ReportRule; entries: EntryWithJob[] }>();
  const order: string[] = [];
  for (const e of entries) {
    const re = toRuleEntry(e);
    const rule = matchedRule(rules, re);
    const key = reportGroupKey(rule, re, e.id);
    let g = groups.get(key);
    if (!g) {
      g = { rule, entries: [] };
      groups.set(key, g);
      order.push(key);
    }
    g.entries.push(e);
  }

  const lines: ReportLine[] = order.map((key) => {
    const { rule, entries: es } = groups.get(key)!;
    const first = es[0];
    const label = reportGroupLabel(rule, toRuleEntry(first), es.length);
    return {
      key,
      label,
      type: first.type,
      ticket: first.ticket,
      hours: round2(es.reduce((a, e) => a + e.hours, 0)),
      tags: unionTags(es),
      count: es.length,
      entries: es.map(toLineEntry),
      // Expandable when it merges several entries, or when a single entry's label
      // HIDES its description (e.g. "Meetings"). A lone ticket line whose label
      // already shows the description ("PROJ-80: …") is not a group.
      expandable: es.length > 1 || !label.includes(first.description.trim()),
    };
  });

  lines.sort((a, b) => a.type.localeCompare(b.type) || b.hours - a.hours || a.label.localeCompare(b.label));
  return { date, lines, total: round2(lines.reduce((a, l) => a + l.hours, 0)) };
}

export function getRewrittenReport(week: WeekInfo, filter: { reportedBy?: string } = {}): RewrittenReport {
  const settings = getReportSettings();
  const rules = getReportRules(settings);
  const entries = listEntries({ from: week.startIso, to: week.endIso, reportedBy: filter.reportedBy });

  const byDate = new Map<string, EntryWithJob[]>();
  for (const e of entries) (byDate.get(e.date) ?? byDate.set(e.date, []).get(e.date)!).push(e);

  const days: ReportDay[] = [];
  for (const d of week.days) {
    const iso = isoDate(d);
    const dayEntries = byDate.get(iso);
    if (dayEntries?.length) days.push(buildDay(iso, dayEntries, rules));
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
