import { asc, eq } from "drizzle-orm";
import { getDb, getSqlite, schema } from "@/db";
import type { EntrySpan, TimeEntry } from "@/db/schema";
import { combineDescription, divideHours, stretchOf } from "./entry-timeline";
import { ValidationError } from "./errors";
import { round2 } from "./format";
import { listPausesByDate } from "./pauses";
import { getTagsForEntries, getOrCreateTags, setEntryTags } from "./tags";
import { t } from "@/lib/i18n/server";

const { entrySpans, timeEntries } = schema;

/**
 * Parallel work, kept whole. A span groups tasks that belong together — done at the same time, or
 * under a collecting entry (a mob day). Every task stays an entry of its own: its real hours are in
 * `worked_hours`, its real start in `start`, its evidence (todos, context) on it. What changes with
 * the span's mode is only the BOOKED hours (`hours` — what the reports and the exports read):
 *   combine     a spanning entry (the head, made here) carries the stretch's hours; the tasks book 0
 *   divide      the stretch's hours shared between the tasks in proportion to what each worked
 *   sequential  each task books what it worked (the group itself nothing)
 *   collect     a collecting entry of yours (the head) carries the hours; the tasks book 0
 *   remainder   the tasks book what they worked, one after the other, and the head (yours) the time that is left of its total
 * The total of a collecting entry (what the group is worth: 8 h of a mob day) is kept in its worked_hours whatever it books —
 * so every way of booking can be switched back and forth without losing it.
 * Nothing is rewritten or removed by switching — except a head this module made itself (`head_auto`),
 * which is only the booking of a combined span. Server only; no dependency on entries.ts (it calls this).
 */

export type SpanMode = "combine" | "divide" | "sequential" | "collect" | "remainder";
export const SPAN_MODES: SpanMode[] = ["combine", "divide", "sequential", "collect", "remainder"];
export type { EntrySpan };

/** What was really worked on a task (its `hours` are what it books). */
export const workedOf = (e: Pick<TimeEntry, "hours" | "workedHours">) => e.workedHours ?? e.hours;

const now = () => new Date().toISOString();
const breaksOf = (date: string) => listPausesByDate(date, date)[date] ?? [];
const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const getSpan = (id: string | null | undefined): EntrySpan | undefined => (id ? getDb().select().from(entrySpans).where(eq(entrySpans.id, id)).get() : undefined);
export const spansOn = (date: string): EntrySpan[] => getDb().select().from(entrySpans).where(eq(entrySpans.date, date)).all();
export const spanOfHead = (entryId: number): EntrySpan | undefined => getDb().select().from(entrySpans).where(eq(entrySpans.headId, entryId)).get();
export const entryRow = (id: number): TimeEntry | undefined => getDb().select().from(timeEntries).where(eq(timeEntries.id, id)).get();

/** The tasks of a span, by start. */
export function membersOf(spanId: string): TimeEntry[] {
  return getDb().select().from(timeEntries).where(eq(timeEntries.spanId, spanId)).orderBy(asc(timeEntries.start), asc(timeEntries.id)).all();
}

/** A span of a head (a collecting entry, a combined one) — made when an entry is flagged a group. */
export function ensureHeadSpan(entryId: number, mode: "collect" | "combine" = "collect"): EntrySpan {
  const e = entryRow(entryId);
  if (!e) throw new ValidationError(t("Time entry #{id} not found.", { id: entryId }));
  const have = spanOfHead(entryId);
  if (have) return have;
  const span: EntrySpan = { id: newId(), date: e.date, mode, headId: entryId, headAuto: mode === "combine", createdAt: now() };
  getDb().insert(entrySpans).values(span).run();
  getDb().update(timeEntries).set({ isGroup: true, groupKind: mode, ...(mode === "collect" ? { workedHours: e.workedHours ?? e.hours } : {}) }).where(eq(timeEntries.id, entryId)).run();
  return span;
}

/** A span with no head yet (parallel work booked divided / one after the other, or about to be combined). */
export function createSpan(date: string, mode: Exclude<SpanMode, "collect" | "remainder">): EntrySpan {
  const span: EntrySpan = { id: newId(), date, mode, headId: null, headAuto: false, createdAt: now() };
  getDb().insert(entrySpans).values(span).run();
  return span;
}

/** A task joins a span: its real hours kept (worked_hours), what it books follows the mode. */
export function linkMember(entryId: number, spanId: string, opts: { recompute?: boolean } = {}): void {
  const e = entryRow(entryId);
  const span = getSpan(spanId);
  if (!e || !span) throw new ValidationError(t("Time entry #{id} not found.", { id: entryId }));
  if (e.date !== span.date) throw new ValidationError(t("A group collects the work of its own day ({date}).", { date: span.date }));
  if (spanOfHead(entryId)) throw new ValidationError(t("A group entry can't go under another one."));
  if (span.headId === entryId) throw new ValidationError(t("An entry can't go under itself."));
  getSqlite().transaction(() => {
    if (e.spanId && e.spanId !== spanId) unlinkMember(entryId);
    const fresh = entryRow(entryId)!;
    getDb().update(timeEntries).set({ spanId, workedHours: workedOf(fresh), updatedAt: now() }).where(eq(timeEntries.id, entryId)).run();
    if (opts.recompute !== false) recomputeSpan(spanId);
  })();
}

/** A task leaves its span: it books what it worked again, on its own. The span is recalculated (or ends, with fewer than two tasks). */
export function unlinkMember(entryId: number): void {
  const e = entryRow(entryId);
  if (!e?.spanId) return;
  const spanId = e.spanId;
  getSqlite().transaction(() => {
    getDb().update(timeEntries).set({ hours: workedOf(e), workedHours: null, spanId: null, updatedAt: now() }).where(eq(timeEntries.id, entryId)).run();
    recomputeSpan(spanId);
  })();
}

/** A collecting entry of yours is an ordinary entry again: it books its total. */
function restoreHead(headId: number): void {
  const h = entryRow(headId);
  if (h) getDb().update(timeEntries).set({ isGroup: false, groupKind: null, hours: h.workedHours ?? h.hours, workedHours: null }).where(eq(timeEntries.id, headId)).run();
}

/** The span ends: every task books what it worked; a head made here goes with it (a collecting entry of yours stays). */
export function dissolveSpan(spanId: string): void {
  const span = getSpan(spanId);
  if (!span) return;
  getSqlite().transaction(() => {
    for (const m of membersOf(spanId)) getDb().update(timeEntries).set({ hours: workedOf(m), workedHours: null, spanId: null, updatedAt: now() }).where(eq(timeEntries.id, m.id)).run();
    if (span.headId) {
      if (span.headAuto) getDb().delete(timeEntries).where(eq(timeEntries.id, span.headId)).run();
      else restoreHead(span.headId);
    }
    getDb().delete(entrySpans).where(eq(entrySpans.id, spanId)).run();
  })();
}

/**
 * What the tasks of a span BOOK, by its mode — and the head of a combined span kept up to date.
 * Idempotent: called whenever a task comes, goes or changes. A span of tasks only (not collecting)
 * with fewer than two tasks ends.
 */
export function recomputeSpan(spanId: string): void {
  const span = getSpan(spanId);
  if (!span) return;
  const db = getDb();
  const members = membersOf(spanId);
  const head = span.headId ? entryRow(span.headId) : undefined;
  if (head && !span.headAuto) {
    // A collecting entry of yours: what it and its tasks BOOK follows the mode; nothing else of it is touched (its words, ticket,
    // start stay), and its total is kept in worked_hours.
    const total = head.workedHours ?? head.hours;
    const worked = members.map((m) => ({ id: m.id, hours: workedOf(m), start: m.start }));
    const sum = round2(worked.reduce((s, m) => s + m.hours, 0));
    const way = span.mode === "combine" ? "collect" : span.mode;
    const loose = members.length === 0; // nothing to carry the hours: the group books its total
    const shares = way === "divide" && !loose ? divideHours(total, worked) : null;
    // all on the group · the remainder: the group books what the tasks leave · sequential and the time divided: the tasks book, the group nothing
    const headBooks = loose || way === "collect" ? total : way === "remainder" ? Math.max(0, round2(total - sum)) : 0;
    for (const m of members) db.update(timeEntries).set({ hours: way === "collect" ? 0 : shares ? shares.get(m.id)! : workedOf(m) }).where(eq(timeEntries.id, m.id)).run();
    db.update(timeEntries).set({ hours: headBooks, workedHours: total }).where(eq(timeEntries.id, head.id)).run();
    return;
  }
  // (no head of its own — or one made here — and the way needs a collecting entry: those spans end)
  if (!head && (span.mode === "collect" || span.mode === "remainder")) return void dissolveSpan(spanId);
  if (members.length < 2) return void dissolveSpan(spanId);
  const worked = members.map((m) => ({ id: m.id, hours: workedOf(m), start: m.start }));
  const stretch = stretchOf(worked, breaksOf(span.date));
  if (span.mode === "sequential" || span.mode === "divide" || span.mode === "remainder") {
    const shares = span.mode === "divide" ? divideHours(stretch.hours, worked) : null;
    for (const m of members) db.update(timeEntries).set({ hours: shares ? shares.get(m.id)! : workedOf(m) }).where(eq(timeEntries.id, m.id)).run();
    // (a combined span turned into another way of booking: the head Zeff made goes)
    if (span.headId && span.headAuto) {
      db.delete(timeEntries).where(eq(timeEntries.id, span.headId)).run();
      db.update(entrySpans).set({ headId: null, headAuto: false }).where(eq(entrySpans.id, spanId)).run();
    }
    return;
  }
  // combine: one spanning entry carries the stretch's hours; the tasks book 0
  const first = members[0];
  const tickets = [...new Set(members.map((m) => (m.ticket ?? "").toUpperCase()).filter(Boolean))];
  const fields = {
    hours: stretch.hours,
    description: combineDescription(members.map((m) => ({ ticket: m.ticket, description: m.description }))),
    ticket: tickets.length === 1 ? tickets[0] : null,
    start: stretch.from,
    updatedAt: now(),
  };
  let headId = span.headId;
  if (headId && entryRow(headId)) {
    db.update(timeEntries).set(fields).where(eq(timeEntries.id, headId)).run();
  } else {
    headId = db
      .insert(timeEntries)
      .values({ ...fields, jobId: first.jobId, projectId: first.projectId, date: span.date, type: first.type, reportedBy: first.reportedBy, source: "web", isGroup: true, groupKind: "combine" })
      .returning({ id: timeEntries.id })
      .get().id;
    const tags = [...new Set([...getTagsForEntries(members.map((m) => m.id)).values()].flat().map((x) => x.name))];
    if (tags.length) setEntryTags(headId, getOrCreateTags(tags).map((x) => x.id));
    db.update(entrySpans).set({ headId, headAuto: true }).where(eq(entrySpans.id, spanId)).run();
  }
  for (const m of members) db.update(timeEntries).set({ hours: 0 }).where(eq(timeEntries.id, m.id)).run();
}

/**
 * A span booked another way. Only booked hours change (and a head made here comes or goes); the
 * tasks, their real hours, starts, words and evidence stay — and so does a collecting entry of yours:
 * only what it books changes (its total is kept), so any way can be switched back.
 */
export function setSpanMode(spanId: string, mode: SpanMode): EntrySpan {
  const span = getSpan(spanId);
  if (!span) throw new ValidationError(t("Nothing grouped there any more."));
  if (mode === span.mode) return span;
  const userHead = !!span.headId && !span.headAuto && !!entryRow(span.headId);
  if (mode === "remainder" && !userHead) throw new ValidationError(t("The remaining time needs a collecting entry to be booked on."));
  if (userHead) {
    // "Book all on group" is collecting; the others change what the entry and its tasks book.
    getDb().update(entrySpans).set({ mode: mode === "combine" ? "collect" : mode }).where(eq(entrySpans.id, spanId)).run();
    recomputeSpan(spanId);
    return getSpan(spanId) ?? { ...span, mode };
  }
  if (mode === "collect") {
    // The combined entry becomes yours: it keeps its hours and words; Zeff no longer rewrites it.
    if (!span.headId || !span.headAuto) throw new ValidationError(t("There is no entry to collect under."));
    getDb().update(entrySpans).set({ mode, headAuto: false }).where(eq(entrySpans.id, spanId)).run();
    getDb().update(timeEntries).set({ groupKind: "collect" }).where(eq(timeEntries.id, span.headId)).run();
    recomputeSpan(spanId);
    return getSpan(spanId)!;
  }
  getDb().update(entrySpans).set({ mode }).where(eq(entrySpans.id, spanId)).run();
  recomputeSpan(spanId);
  return getSpan(spanId) ?? { ...span, mode };
}

/** Before a task's entry is deleted: its span is recalculated afterwards; a head's span ends (the tasks book what they worked). */
export function beforeEntryDeleted(entry: TimeEntry): () => void {
  const asHead = spanOfHead(entry.id);
  if (asHead) {
    // (the head itself is being deleted: take the tasks out first, and the span with it — never delete a head twice)
    getSqlite().transaction(() => {
      for (const m of membersOf(asHead.id)) getDb().update(timeEntries).set({ hours: workedOf(m), workedHours: null, spanId: null, updatedAt: now() }).where(eq(timeEntries.id, m.id)).run();
      getDb().delete(entrySpans).where(eq(entrySpans.id, asHead.id)).run();
    })();
    return () => {};
  }
  const spanId = entry.spanId;
  return () => {
    if (spanId) recomputeSpan(spanId);
  };
}

/** A head loses its flag: its span ends (the tasks book what they worked). */
export function releaseHead(entryId: number): void {
  const span = spanOfHead(entryId);
  if (!span) return;
  getSqlite().transaction(() => {
    for (const m of membersOf(span.id)) getDb().update(timeEntries).set({ hours: workedOf(m), workedHours: null, spanId: null, updatedAt: now() }).where(eq(timeEntries.id, m.id)).run();
    getDb().delete(entrySpans).where(eq(entrySpans.id, span.id)).run();
    restoreHead(entryId);
  })();
}

