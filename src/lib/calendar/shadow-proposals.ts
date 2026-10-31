/**
 * A shadow calendar's appointments as proposals (@/lib/proposals, source "calendar-shadow"): every appointment in a shadow
 * calendar — a block of the day plan ("Tagesplan <day>"), one a page planned — is an open proposal while it is there. Kept up
 * to date by the calendar model (ir.ts) whenever a shadow calendar changes: a new appointment proposed, one moved proposed anew
 * (the old one expired), one gone expired. One you dismissed (or accepted) that comes again unchanged — the day planned once
 * more — is taken out again: never proposed twice. Accepting and dismissing are the Calendar plugin's (plugins/calendar/proposals),
 * through `decide()`. Server only; imports nothing of ir.ts (which imports this).
 */
import { and, eq, inArray, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { expireProposals, inputHashOf, openProposals, propose, proposalByHash, type Proposal } from "@/lib/proposals";

const { calendars, calendarEvents } = schema;

/** A shadow calendar's key: one of Zeff's own, marked so (no column of its own — the key says it). */
export const SHADOW_PREFIX = "zeff:shadow-";
export const SHADOW_SOURCE = "calendar-shadow";
/** The day plan's calendars ("Tagesplan <day>", lib/heute-plan): their appointments are blocks of the plan. */
export const DAY_PLAN_PREFIX = "Tagesplan ";

export type ShadowPayload = { calendarId: number; key: string; title: string; start: string; end: string; allDay: boolean; calendar: string };

const subjectPrefix = (calendarId: number) => `shadow:${calendarId}:`;

/**
 * A calendar's appointments and its open proposals brought together — nothing for one that isn't a shadow calendar. Never
 * throws (the calendar's own write went through).
 */
export function syncShadowProposals(calendarId: number): void {
  try {
    const db = getDb();
    const cal = db.select().from(calendars).where(eq(calendars.id, calendarId)).get();
    const prefix = subjectPrefix(calendarId);
    if (!cal) {
      // (gone: what it proposed went with it — only asked when it was a shadow calendar with something open)
      expireProposals(openProposals(SHADOW_SOURCE, { subjectPrefix: prefix }).map((p) => p.id));
      return;
    }
    if (!cal.key.startsWith(SHADOW_PREFIX)) return;
    const kind = cal.name.startsWith(DAY_PLAN_PREFIX) ? "day-plan-block" : "shadow-event";
    const live = new Set<string>();
    const drop: number[] = [];
    for (const e of db.select().from(calendarEvents).where(eq(calendarEvents.calendarId, calendarId)).all()) {
      if (e.seriesId) continue; // an occurrence changed on its own: part of its series' proposal
      const hash = inputHashOf(calendarId, e.key, e.title, e.start, e.end, e.allDay, e.recurrence ?? "");
      const known = proposalByHash(SHADOW_SOURCE, hash);
      if (known && (known.status === "dismissed" || known.status === "accepted")) {
        drop.push(e.id);
        continue;
      }
      live.add(hash);
      propose<ShadowPayload>({
        source: SHADOW_SOURCE,
        inputHash: hash,
        kind,
        subjectRef: `${prefix}${e.key}`,
        payload: { calendarId, key: e.key, title: e.title, start: e.start, end: e.end, allDay: e.allDay, calendar: cal.name },
        why: cal.name,
        evidenceRefs: e.todoId ? [`todo:${e.todoId}`] : [],
        reopen: true,
      });
    }
    if (drop.length) db.delete(calendarEvents).where(or(inArray(calendarEvents.id, drop), inArray(calendarEvents.seriesId, drop))).run();
    expireProposals(openProposals(SHADOW_SOURCE, { subjectPrefix: prefix }).filter((p) => !live.has(p.inputHash)).map((p) => p.id));
  } catch (err) {
    console.error("[shadow-proposals]", err);
  }
}

const synced = new WeakSet<object>();

/** Every shadow calendar brought together with its proposals — once per process and account (those made before the proposals were). */
export function syncAllShadowProposals(): void {
  const db = getDb();
  if (synced.has(db)) return;
  synced.add(db);
  for (const c of db.select({ id: calendars.id, key: calendars.key }).from(calendars).all()) if (c.key.startsWith(SHADOW_PREFIX)) syncShadowProposals(c.id);
}

/** The appointment a proposal is about (its row id) — null: gone. */
export function shadowEventId(p: Proposal): number | null {
  const x = p.payload as Partial<ShadowPayload>;
  const r = getDb()
    .select({ id: calendarEvents.id })
    .from(calendarEvents)
    .where(and(eq(calendarEvents.calendarId, Number(x.calendarId)), eq(calendarEvents.key, String(x.key ?? ""))))
    .get();
  return r?.id ?? null;
}

/** The open proposal of a shadow calendar's appointment (by its row id) — brought up to date first, when there is none yet. */
export function shadowProposalOf(eventId: number): Proposal | null {
  const db = getDb();
  const e = db.select({ calendarId: calendarEvents.calendarId, key: calendarEvents.key }).from(calendarEvents).where(eq(calendarEvents.id, eventId)).get();
  if (!e) return null;
  const find = () => openProposals(SHADOW_SOURCE, { subjectRef: `${subjectPrefix(e.calendarId)}${e.key}` })[0] ?? null;
  const found = find();
  if (found) return found;
  syncShadowProposals(e.calendarId);
  return find();
}

/** A shadow appointment taken out (with a series' own occurrences) — not through ir's deleteEvent: its proposal is being decided. */
export function removeShadowEvent(eventId: number): void {
  getDb()
    .delete(calendarEvents)
    .where(or(eq(calendarEvents.id, eventId), eq(calendarEvents.seriesId, eventId)))
    .run();
}
