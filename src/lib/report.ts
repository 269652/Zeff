import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { EntryType, ReportSettings } from "@/db/schema";
import type { MeetingJobRule } from "./calendar/meetings";
import { listEntries, type EntryWithJob } from "./entries";
import { DEFAULT_TIMO_CONFIG, type TimoConfig } from "./timo";
import { round2 } from "./format";
import { ValidationError } from "./errors";
import { t } from "@/lib/i18n/server";
import { entryTypeMap } from "./entry-types";
import { getTicketSummaries } from "./jira/store";
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
import type { TypeRule } from "./type-rules-shared";
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
  if (s.groupMeetingsByDay) rules.push({ id: "meetings", conditions: [{ field: "type", value: "meeting" }], template: s.meetingsLabel || "Meetings" });
  rules.push({ id: "tickets", conditions: [{ field: "type", value: "ticket" }], template: s.ticketTemplate || "{ticket}: {desc}" });
  rules.push({ id: "rest", conditions: [], template: "{desc}" });
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

/** Stored meeting→job rules (auto-assign a job to an imported meeting by its title). */
export function getMeetingJobRules(s: ReportSettings): MeetingJobRule[] {
  return parseMeetingJobRules(s.meetingJobRules);
}

/** Job for imported meetings that no meeting→job rule matches (null = the first job). */
export function getMeetingDefaultJob(s: ReportSettings): string | null {
  return s.meetingDefaultJob?.trim() || null;
}

/** Title substrings whose imported meetings start unchecked (see isExcludedMeeting). */
export function getMeetingExcludeRules(s: ReportSettings): string[] {
  return parseMeetingExcludeRules(s.meetingExcludeRules);
}

export function parseMeetingExcludeRules(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json);
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    return raw
      .map((r) => String(r ?? "").trim())
      .filter((r) => r && !seen.has(r.toLowerCase()) && seen.add(r.toLowerCase()));
  } catch {
    return [];
  }
}

export function parseMeetingJobRules(json: string | null | undefined): MeetingJobRule[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((r) => ({ match: String(r?.match ?? "").trim(), jobNumber: String(r?.jobNumber ?? "").trim() }))
      .filter((r) => r.match && r.jobNumber);
  } catch {
    return [];
  }
}

/** Per-job Roar WorkCode overrides ({ jobNumber: workCode }); used by the Roar export. */
export function getRoarWorkcodes(s: ReportSettings): Record<string, string> {
  return parseRoarWorkcodes(s.roarWorkcodes);
}

export function parseRoarWorkcodes(json: string | null | undefined): Record<string, string> {
  if (!json) return {};
  try {
    const raw = JSON.parse(json);
    if (!raw || typeof raw !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const num = String(k).trim();
      const code = String(v ?? "").trim();
      if (num && code) out[num] = code;
    }
    return out;
  } catch {
    return {};
  }
}

/** The default TimO work day (start/hours/break) used by the TimO export. */
export function getTimoConfig(s: ReportSettings): TimoConfig {
  return parseTimoConfig(s.timoConfig);
}

export function parseTimoConfig(json: string | null | undefined): TimoConfig {
  if (!json) return { ...DEFAULT_TIMO_CONFIG };
  try {
    const raw = JSON.parse(json) as Partial<TimoConfig>;
    const startTime = /^\d{1,2}:\d{2}$/.test(String(raw?.startTime ?? "")) ? String(raw.startTime) : DEFAULT_TIMO_CONFIG.startTime;
    const workdayHours = Number(raw?.workdayHours);
    const breakMinutes = Number(raw?.breakMinutes);
    return {
      startTime,
      workdayHours: Number.isFinite(workdayHours) && workdayHours > 0 && workdayHours <= 24 ? workdayHours : DEFAULT_TIMO_CONFIG.workdayHours,
      breakMinutes: Number.isFinite(breakMinutes) && breakMinutes >= 0 && breakMinutes < 600 ? breakMinutes : DEFAULT_TIMO_CONFIG.breakMinutes,
      absenceJobNumber: String(raw?.absenceJobNumber ?? "").trim(),
      absenceType: String(raw?.absenceType ?? "").trim() || DEFAULT_TIMO_CONFIG.absenceType,
    };
  } catch {
    return { ...DEFAULT_TIMO_CONFIG };
  }
}

export function updateReportSettings(patch: {
  rules?: ReportRule[];
  meetingJobRules?: MeetingJobRule[];
  meetingDefaultJob?: string | null;
  meetingExcludeRules?: string[];
  typeRules?: TypeRule[];
  roarWorkcodes?: Record<string, string>;
  timoConfig?: TimoConfig;
}): ReportSettings {
  if (patch.rules !== undefined) {
    const err = validateRules(patch.rules, t);
    if (err) throw new ValidationError(err);
  }
  getReportSettings();
  return getDb()
    .update(reportSettings)
    .set({
      ...(patch.rules !== undefined && { rules: JSON.stringify(patch.rules) }),
      ...(patch.meetingJobRules !== undefined && { meetingJobRules: JSON.stringify(patch.meetingJobRules) }),
      ...(patch.meetingDefaultJob !== undefined && { meetingDefaultJob: patch.meetingDefaultJob || null }),
      ...(patch.meetingExcludeRules !== undefined && { meetingExcludeRules: JSON.stringify(patch.meetingExcludeRules) }),
      ...(patch.typeRules !== undefined && { typeRules: JSON.stringify(patch.typeRules) }),
      ...(patch.roarWorkcodes !== undefined && { roarWorkcodes: JSON.stringify(patch.roarWorkcodes) }),
      ...(patch.timoConfig !== undefined && { timoConfig: JSON.stringify(patch.timoConfig) }),
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
  jobNumber: string;
  jobName: string;
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
  return {
    id: e.id,
    date: e.date,
    description: e.description,
    hours: e.hours,
    ticket: e.ticket,
    type: e.type,
    tags: e.tags,
    jobNumber: e.job.number,
    jobName: e.job.name,
  };
}

/** Flatten an entry into the shape the rules match on (job + Jira ticket title lifted in). */
/** Type key → configured name, for {type}. */
type TypeLabels = Record<string, string>;

function typeLabels(): TypeLabels {
  return Object.fromEntries(Object.values(entryTypeMap()).map((t) => [t.key, t.label]));
}

function toRuleEntry(e: EntryWithJob, summaries: Map<string, string>, labels: TypeLabels): RuleEntry {
  return {
    type: e.type,
    ticket: e.ticket,
    ticketName: e.ticket ? (summaries.get(e.ticket.toUpperCase()) ?? "") : "",
    typeLabel: labels[e.type] ?? e.type,
    description: e.description,
    tags: e.tags,
    jobNumber: e.job.number,
    jobName: e.job.name,
    project: e.project?.title ?? "",
  };
}

/**
 * Group a day's entries by the label their first matching rule renders — entries
 * that render to the same label merge (hours summed). A line stays expandable when
 * it merges several entries, or when its label rewrites a single entry's text.
 */
function buildDay(date: string, entries: EntryWithJob[], rules: ReportRule[], summaries: Map<string, string>, labels: TypeLabels): ReportDay {
  const groups = new Map<string, { rule: ReportRule; entries: EntryWithJob[] }>();
  const order: string[] = [];
  for (const e of entries) {
    const re = toRuleEntry(e, summaries, labels);
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
    const label = reportGroupLabel(rule, toRuleEntry(first, summaries, labels), es.length);
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
  const summaries = getTicketSummaries();
  const labels = typeLabels();

  const byDate = new Map<string, EntryWithJob[]>();
  for (const e of entries) (byDate.get(e.date) ?? byDate.set(e.date, []).get(e.date)!).push(e);

  const days: ReportDay[] = [];
  for (const d of week.days) {
    const iso = isoDate(d);
    const dayEntries = byDate.get(iso);
    if (dayEntries?.length) days.push(buildDay(iso, dayEntries, rules, summaries, labels));
  }

  return { week, days, total: round2(days.reduce((a, d) => a + d.total, 0)), settings, filter };
}

/** One rewritten report line's share for a single job on a day (see getRewrittenJobLines). */
export type RewrittenJobLine = {
  date: string;
  jobNumber: string;
  jobName: string;
  /** The line's label as the report rules render it, e.g. "Meetings" or "PROJ-401: <Jira title>". */
  label: string;
  /** Summed hours of the merged entries (unrounded). */
  hours: number;
  /** How many entries merged into it. */
  count: number;
  /** The first entry — a fallback for labels that render empty. */
  first: { ticket: string | null; description: string };
  /** The Zeff entries merged into it. */
  entryIds: number[];
};

/**
 * The week as the report rewrites it, split per job: one item per day × job × report
 * group, labelled by the same rules as the Report view. Timesheets book per job, so a
 * "Meetings" line spanning two jobs becomes one "Meetings" item for each.
 */
export function getRewrittenJobLines(week: WeekInfo, filter: { reportedBy?: string } = {}): RewrittenJobLine[] {
  const rules = getReportRules(getReportSettings());
  const summaries = getTicketSummaries();
  const labels = typeLabels();
  const entries = listEntries({ from: week.startIso, to: week.endIso, reportedBy: filter.reportedBy });
  const groups = new Map<string, { e: EntryWithJob; rule: ReportRule; re: RuleEntry; hours: number; count: number; ids: number[] }>();
  // listEntries is newest first; go oldest first so each day's lines read chronologically.
  for (const e of [...entries].reverse()) {
    const re = toRuleEntry(e, summaries, labels);
    const rule = matchedRule(rules, re);
    const key = `${e.date}|${e.job.number}|${reportGroupKey(rule, re, e.id)}`;
    const g = groups.get(key) ?? { e, rule, re, hours: 0, count: 0, ids: [] };
    g.hours = round2(g.hours + e.hours);
    g.count += 1;
    g.ids.push(e.id);
    groups.set(key, g);
  }
  return [...groups.values()].map(({ e, rule, re, hours, count, ids }) => ({
    date: e.date,
    jobNumber: e.job.number,
    jobName: e.job.name,
    label: reportGroupLabel(rule, re, count).trim(),
    hours,
    count,
    first: { ticket: e.ticket, description: e.description },
    entryIds: ids,
  }));
}

/** A report label's share of a job over a period (see getJobReportSummaries). */
export type JobLabelSummary = {
  label: string;
  /** The first entry's type (for the badge). */
  type: EntryType;
  /** The ticket, when every entry behind the label has the same one. */
  ticket: string | null;
  hours: number;
  /** Days it was booked on. */
  days: number;
  /** Entries behind it. */
  count: number;
};

export type JobReportSummary = {
  jobNumber: string;
  jobName: string;
  hours: number;
  /** Most hours first. */
  lines: JobLabelSummary[];
};

/**
 * What each job's time went to over a period: every entry labelled by the report rules
 * (as on its own, so a template showing the description lists each one), summed per job
 * and label. Jobs with the most hours first.
 */
export function getJobReportSummaries(fromIso: string, toIso: string, filter: { reportedBy?: string } = {}): JobReportSummary[] {
  const rules = getReportRules(getReportSettings());
  const summaries = getTicketSummaries();
  const labels = typeLabels();
  const entries = listEntries({ from: fromIso, to: toIso, reportedBy: filter.reportedBy });
  type Acc = JobLabelSummary & { dates: Set<string> };
  const jobs = new Map<string, { jobNumber: string; jobName: string; hours: number; lines: Map<string, Acc> }>();
  // listEntries is newest first; go oldest first so equal-hour labels keep their booking order.
  for (const e of [...entries].reverse()) {
    const re = toRuleEntry(e, summaries, labels);
    const label = reportGroupLabel(matchedRule(rules, re), re, 1).trim();
    const job = jobs.get(e.job.number) ?? { jobNumber: e.job.number, jobName: e.job.name, hours: 0, lines: new Map<string, Acc>() };
    job.hours = round2(job.hours + e.hours);
    const line = job.lines.get(label) ?? { label, type: e.type, ticket: e.ticket, hours: 0, days: 0, count: 0, dates: new Set<string>() };
    line.hours = round2(line.hours + e.hours);
    line.count += 1;
    line.dates.add(e.date);
    if ((line.ticket ?? "").toUpperCase() !== (e.ticket ?? "").toUpperCase()) line.ticket = null;
    job.lines.set(label, line);
    jobs.set(e.job.number, job);
  }
  return [...jobs.values()]
    .map((j) => ({
      jobNumber: j.jobNumber,
      jobName: j.jobName,
      hours: j.hours,
      lines: [...j.lines.values()]
        .map(({ dates, ...l }) => ({ ...l, days: dates.size }))
        .sort((a, b) => b.hours - a.hours),
    }))
    .sort((a, b) => b.hours - a.hours || a.jobNumber.localeCompare(b.jobNumber, undefined, { numeric: true }));
}

/** Plain-text rendering of job summaries ("job — h", then "  - label — h (n days)"), for copy/paste. */
export function jobSummariesToText(title: string, total: number, jobs: JobReportSummary[], formatHours: (h: number) => string): string {
  const lines = [`${title} — ${formatHours(total)}h`, ""];
  for (const j of jobs) {
    lines.push(`${j.jobNumber} ${j.jobName} — ${formatHours(j.hours)}h`);
    for (const l of j.lines) lines.push(`  - ${l.label} — ${formatHours(l.hours)}h (${l.days === 1 ? t("1 day") : t("{n} days", { n: l.days })})`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

/** Plain-text rendering for copy/paste into a timesheet. */
export function reportToText(report: RewrittenReport, formatHours: (h: number) => string): string {
  const lines: string[] = [];
  for (const day of report.days) {
    lines.push(`${day.date}  (${formatHours(day.total)}h)`);
    for (const l of day.lines) {
      const tags = l.tags.length ? " " + l.tags.map((tag) => `#${tag.name}`).join(" ") : "";
      lines.push(`  - ${l.label}${tags} — ${formatHours(l.hours)}h`);
    }
    lines.push("");
  }
  lines.push(t("Total: {hours}h", { hours: formatHours(report.total) }));
  return lines.join("\n");
}
