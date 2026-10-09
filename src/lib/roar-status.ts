import { parseISO } from "date-fns";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { NO_JOB_NUMBER } from "./projects-shared";
import { getRewrittenJobLines } from "./report";
import { clipComment, roarComment, roundRoarHours } from "./roar";
import { shiftWeek, weekFromDate, type WeekInfo } from "./week";

const { roarEntries, timeEntries } = schema;

/** One entry as roar_pull returns it. */
export type RoarPulledEntry = {
  id: string;
  jobNumber: string;
  jobName: string;
  date: string;
  hours: number;
  comment: string;
  status: string;
  rejectionComment: string;
  approver: string;
  approvedBy: string;
  submittedAt: string | null;
  approvedAt: string | null;
};

export type RoarStatusKind = "approved" | "rejected" | "submitted" | "draft";

/** A Zeff entry's status in Roar (from the Roar entry its report line was booked as). */
export type EntryRoarStatus = {
  kind: RoarStatusKind;
  /** Roar's word for it, e.g. "Approved". */
  status: string;
  comment: string;
  rejectionComment: string | null;
  approver: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
};

export function roarStatusKind(status: string): RoarStatusKind {
  const s = status.toLowerCase();
  if (s.includes("unsubmit") || s.includes("not submit")) return "draft"; // "Unsubmitted" contains "submit"
  if (s.includes("approv")) return "approved";
  if (s.includes("reject")) return "rejected";
  if (s.includes("submit") || s.includes("pending")) return "submitted";
  return "draft";
}

/** Replace the stored Roar entries of a week with a fresh pull. */
export function saveRoarPull(weekStartIso: string, entries: RoarPulledEntry[]): void {
  const pulledAt = new Date().toISOString();
  getDb().transaction((tx) => {
    tx.delete(roarEntries).where(eq(roarEntries.weekStart, weekStartIso)).run();
    if (entries.length) {
      tx.insert(roarEntries)
        .values(
          entries.map((e) => ({
            id: e.id,
            weekStart: weekStartIso,
            jobNumber: e.jobNumber,
            date: e.date,
            hours: e.hours,
            comment: e.comment,
            status: e.status,
            rejectionComment: e.rejectionComment || null,
            approver: e.approver || null,
            approvedBy: e.approvedBy || null,
            submittedAt: e.submittedAt,
            approvedAt: e.approvedAt,
            pulledAt,
          })),
        )
        .onConflictDoNothing()
        .run();
    }
  });
}

/** A pulled Roar entry, for the approval summary. */
export type RoarItem = {
  date: string;
  jobNumber: string;
  hours: number;
  comment: string;
  approver: string | null;
  rejectionComment: string | null;
};

export type RoarApprovalSummary = {
  /** Submitted, waiting for the approver. */
  awaiting: RoarItem[];
  rejected: RoarItem[];
  /** Entries with hours that haven't been submitted. */
  unsubmitted: RoarItem[];
  /** The oldest pull among the period's pulled weeks — how fresh this is (null = none pulled). */
  pulledAt: string | null;
  /** Weeks of the period with Zeff entries but no Roar data pulled yet (week keys). */
  unpulledWeeks: string[];
};

/** The Roar entries of a period by approval state, from the weeks pulled so far ("Pull Roar"). */
export function getRoarApprovalSummary(fromIso: string, toIso: string, today: string): RoarApprovalSummary {
  const db = getDb();
  const rows = db
    .select()
    .from(roarEntries)
    .where(and(gte(roarEntries.date, fromIso), lte(roarEntries.date, toIso)))
    .orderBy(asc(roarEntries.date))
    .all();
  const summary: RoarApprovalSummary = { awaiting: [], rejected: [], unsubmitted: [], pulledAt: null, unpulledWeeks: [] };
  for (const r of rows) {
    const item: RoarItem = {
      date: r.date,
      jobNumber: r.jobNumber,
      hours: r.hours,
      comment: r.comment,
      approver: r.approver,
      rejectionComment: r.rejectionComment,
    };
    const kind = roarStatusKind(r.status);
    if (kind === "submitted") summary.awaiting.push(item);
    else if (kind === "rejected") summary.rejected.push(item);
    else if (kind === "draft") summary.unsubmitted.push(item);
  }
  // How fresh: each begun week's last pull; weeks Zeff has time in but nothing was pulled for.
  const booked = new Set(
    db
      .selectDistinct({ date: timeEntries.date })
      .from(timeEntries)
      .where(and(gte(timeEntries.date, fromIso), lte(timeEntries.date, toIso)))
      .all()
      .map((r) => weekFromDate(parseISO(r.date)).startIso),
  );
  const pulls: string[] = [];
  for (let w = weekFromDate(parseISO(fromIso)); w.startIso <= toIso && w.startIso <= today; w = shiftWeek(w, 1)) {
    const at = roarPulledAt(w);
    if (at) pulls.push(at);
    else if (booked.has(w.startIso)) summary.unpulledWeeks.push(w.key);
  }
  summary.pulledAt = pulls.sort()[0] ?? null;
  return summary;
}

/** When the week was last pulled from Roar (null = never). */
export function roarPulledAt(week: WeekInfo): string | null {
  const row = getDb().select({ at: roarEntries.pulledAt }).from(roarEntries).where(eq(roarEntries.weekStart, week.startIso)).limit(1).get();
  return row?.at ?? null;
}

/**
 * Each Zeff entry's Roar status for the week, by entry id. A Roar entry is matched to the
 * report line the export books as it — same job and day, then the same comment, else the
 * same (rounded) hours, else the only line and entry of that job and day — and every Zeff
 * entry of that line gets its status. Entries without a match aren't in Roar (yet).
 */
export function roarStatusByEntry(week: WeekInfo): Record<number, EntryRoarStatus> {
  const rows = getDb().select().from(roarEntries).where(eq(roarEntries.weekStart, week.startIso)).all();
  if (rows.length === 0) return {};
  const lines = getRewrittenJobLines(week);
  const used = new Set<string>();
  const out: Record<number, EntryRoarStatus> = {};
  for (const l of lines) {
    const comment = l.label ? clipComment(l.label) : roarComment(l.first.ticket, l.first.description);
    const hours = roundRoarHours(l.hours);
    const sameCell = (x: { jobNumber: string; date: string }) => x.jobNumber === l.jobNumber && x.date === l.date;
    const candidates = rows.filter((r) => !used.has(r.id) && sameCell(r));
    const hit =
      candidates.find((r) => r.comment === comment) ??
      candidates.find((r) => Math.abs(r.hours - hours) < 0.001) ??
      (candidates.length === 1 && lines.filter(sameCell).length === 1 ? candidates[0] : undefined);
    if (!hit) continue;
    used.add(hit.id);
    const status: EntryRoarStatus = {
      kind: roarStatusKind(hit.status),
      status: hit.status,
      comment: hit.comment,
      rejectionComment: hit.rejectionComment,
      approver: hit.approver,
      approvedBy: hit.approvedBy,
      approvedAt: hit.approvedAt,
    };
    for (const id of l.entryIds) out[id] = status;
  }
  return out;
}

/** A status as a sentence, for tooltips. */
export function roarStatusTitle(s: EntryRoarStatus): string {
  switch (s.kind) {
    case "approved":
      return `Roar: approved${s.approvedBy ? ` by ${s.approvedBy}` : ""}${s.approvedAt ? ` (${s.approvedAt.slice(0, 10)})` : ""}`;
    case "rejected":
      return `Roar: rejected${s.rejectionComment ? ` — ${s.rejectionComment}` : ""}`;
    case "submitted":
      return `Roar: submitted${s.approver ? `, waiting for ${s.approver}` : ""}`;
    default:
      return `Roar: ${s.status || "draft"} (not submitted)`;
  }
}

/** How long a pull of the approvals counts as fresh (the card's Pull Roar shows its ✓ meanwhile). */
export const APPROVALS_FRESH_HOURS = 4;

/** Whether a pull happened less than `hours` ago (as of this request). */
export function pulledWithin(pulledAt: string | null, hours: number): boolean {
  return !!pulledAt && Date.now() - new Date(pulledAt).getTime() < hours * 3600000;
}

/**
 * Whether Zeff and Roar are in sync, as of the last pull: every entry the Roar export books
 * (not the "No job yet" placeholder) is in Roar, and none was rejected.
 */
export function roarInSync(entries: { id: number; job: { number: string } }[], statuses: Record<number, EntryRoarStatus> | undefined): boolean {
  if (!statuses) return false;
  const booked = entries.filter((e) => e.job.number !== NO_JOB_NUMBER);
  return booked.length > 0 && booked.every((e) => statuses[e.id] !== undefined && statuses[e.id].kind !== "rejected");
}

/** What a group of entries (a weekly-table cell) shows; "missing" = some aren't in Roar. */
export type RoarMarkKind = RoarStatusKind | "missing";

/** Any rejected → rejected; any not in Roar → missing; any still waiting → draft / submitted; else approved. */
export function aggregateRoarKind(statuses: (EntryRoarStatus | undefined)[]): RoarMarkKind | null {
  if (statuses.length === 0) return null;
  const known = statuses.filter((s): s is EntryRoarStatus => !!s);
  if (known.some((s) => s.kind === "rejected")) return "rejected";
  if (known.length < statuses.length) return "missing";
  if (known.some((s) => s.kind === "draft")) return "draft";
  if (known.some((s) => s.kind === "submitted")) return "submitted";
  return "approved";
}
