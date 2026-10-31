/**
 * Proposed appointments as proposals (@/lib/proposals, source "calendar", kind "event"): an appointment marked `proposed` — in
 * any calendar: a block of the day plan, one an assistant planned in a page — is an open proposal while it is there. Kept up to
 * date by the calendar model (ir.ts) whenever a calendar's appointments change: a new one proposed, one moved proposed anew (the
 * old one expired), one gone (or accepted in the calendar itself) expired. One you dismissed (or accepted) that comes again
 * unchanged — the day planned once more — is taken out again: never proposed twice. Accepting and dismissing are the Calendar
 * plugin's (plugins/calendar/proposals), through `decide()`. Server only; imports nothing of ir.ts (which imports this).
 */
import { and, eq, inArray, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { expireProposals, inputHashOf, openProposals, propose, proposalByHash, type Proposal } from "@/lib/proposals";

const { calendars, calendarEvents } = schema;

export const PROPOSAL_SOURCE = "calendar";
/** The source the shadow calendars' appointments were proposed under (before any calendar could hold proposals). */
const OLD_SOURCE = "calendar-shadow";
/** The day plan's blocks (lib/heute-plan): their keys start so. */
export const DAY_PLAN_KEY = "plan:";

export type ProposedPayload = { calendarId: number; key: string; title: string; start: string; end: string; allDay: boolean; calendar: string };

const subjectPrefix = (calendarId: number) => `event:${calendarId}:`;

/** What a proposed appointment is made of — its hash (a dismissed one coming again unchanged is known by it). */
export const proposedHash = (calendarId: number, e: { key: string; title: string; start: string; end: string; allDay: boolean; recurrence?: string | null }) =>
  inputHashOf(calendarId, e.key, e.title, e.start, e.end, e.allDay, e.recurrence ?? "");

/** A key for a proposed appointment made of what it is (asked again with the same, it is the same — and stays dismissed). */
export const proposedKey = (prefix: string, e: { title: string; start: string; end: string; allDay?: boolean }) => `${prefix}${inputHashOf(e.title, e.start, e.end, !!e.allDay).slice(0, 16)}`;

/** A calendar's proposed appointments and its open proposals brought together. Never throws (the calendar's own write went through). */
export function syncProposals(calendarId: number): void {
  try {
    const db = getDb();
    const prefix = subjectPrefix(calendarId);
    const cal = db.select().from(calendars).where(eq(calendars.id, calendarId)).get();
    const rows = cal ? db.select().from(calendarEvents).where(and(eq(calendarEvents.calendarId, calendarId), eq(calendarEvents.proposed, true))).all() : [];
    const open = openProposals(PROPOSAL_SOURCE, { subjectPrefix: prefix });
    if (!rows.length && !open.length) return;
    const live = new Set<string>();
    const drop: number[] = [];
    for (const e of rows) {
      if (e.seriesId) continue; // an occurrence changed on its own: part of its series' proposal
      const hash = proposedHash(calendarId, e);
      const known = proposalByHash(PROPOSAL_SOURCE, hash);
      if (known && (known.status === "dismissed" || known.status === "accepted")) {
        drop.push(e.id);
        continue;
      }
      live.add(hash);
      propose<ProposedPayload>({
        source: PROPOSAL_SOURCE,
        inputHash: hash,
        kind: "event",
        subjectRef: `${prefix}${e.key}`,
        payload: { calendarId, key: e.key, title: e.title, start: e.start, end: e.end, allDay: e.allDay, calendar: cal?.name ?? "" },
        why: cal?.name ?? "",
        evidenceRefs: e.todoId ? [`todo:${e.todoId}`] : [],
        reopen: true,
      });
    }
    if (drop.length) db.delete(calendarEvents).where(or(inArray(calendarEvents.id, drop), inArray(calendarEvents.seriesId, drop))).run();
    expireProposals(open.filter((p) => !live.has(p.inputHash)).map((p) => p.id));
  } catch (err) {
    console.error("[calendar-proposals]", err);
  }
}

const synced = new WeakSet<object>();

/** Every calendar's proposed appointments brought together with the proposals — once per process and account (those made before the proposals were). */
export function syncAllProposals(): void {
  const db = getDb();
  if (synced.has(db)) return;
  synced.add(db);
  // (the shadow calendars' proposals of before: their appointments are proposed ones now, proposed again below)
  expireProposals(openProposals(OLD_SOURCE).map((p) => p.id));
  const ids = new Set(db.select({ id: calendarEvents.calendarId }).from(calendarEvents).where(eq(calendarEvents.proposed, true)).all().map((r) => r.id));
  for (const p of openProposals(PROPOSAL_SOURCE)) ids.add(Number((p.payload as Partial<ProposedPayload>).calendarId));
  for (const id of ids) if (id > 0) syncProposals(id);
}

/** The proposed appointment a proposal is about (its row id) — null: gone (or accepted in the calendar meanwhile). */
export function proposedEventId(p: Proposal): number | null {
  const x = p.payload as Partial<ProposedPayload>;
  const r = getDb()
    .select({ id: calendarEvents.id })
    .from(calendarEvents)
    .where(and(eq(calendarEvents.calendarId, Number(x.calendarId)), eq(calendarEvents.key, String(x.key ?? "")), eq(calendarEvents.proposed, true)))
    .get();
  return r?.id ?? null;
}

/** The open proposal of a proposed appointment (by its row id) — brought up to date first, when there is none yet. */
export function proposalOfEvent(eventId: number): Proposal | null {
  const db = getDb();
  const e = db.select({ calendarId: calendarEvents.calendarId, key: calendarEvents.key, proposed: calendarEvents.proposed }).from(calendarEvents).where(eq(calendarEvents.id, eventId)).get();
  if (!e?.proposed) return null;
  const find = () => openProposals(PROPOSAL_SOURCE, { subjectRef: `${subjectPrefix(e.calendarId)}${e.key}` })[0] ?? null;
  const found = find();
  if (found) return found;
  syncProposals(e.calendarId);
  return find();
}

/** A proposed appointment kept: an appointment like any other (a series' own occurrences with it) — not through ir: its proposal is being decided. */
export function keepProposedEvent(eventId: number): void {
  getDb()
    .update(calendarEvents)
    .set({ proposed: false, updatedAt: new Date().toISOString() })
    .where(or(eq(calendarEvents.id, eventId), eq(calendarEvents.seriesId, eventId)))
    .run();
}

/** A proposed appointment taken out (with a series' own occurrences) — not through ir's deleteEvent: its proposal is being decided. */
export function removeProposedEvent(eventId: number): void {
  getDb()
    .delete(calendarEvents)
    .where(or(eq(calendarEvents.id, eventId), eq(calendarEvents.seriesId, eventId)))
    .run();
}
