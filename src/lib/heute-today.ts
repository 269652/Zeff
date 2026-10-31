/**
 * What matters today (the Today page): the appointments of today and tomorrow morning — with the people in them, to prepare —
 * your todos due today or before, the promises due (yours) or overdue (theirs), and what is new since yesterday (people learned,
 * news). Each part only with its plugin; nothing but the database is read. Server only.
 */
import type { TodoView } from "@/lib/todos/shared";
import { dayOf, stampOf } from "@/lib/calendar/ir-shared";
import { isInstalled } from "@/plugins/state";

export type TodayAppointment = { id: number; title: string; start: string; end: string; allDay: boolean; location: string; tomorrow: boolean; online: boolean; people: { id: number; name: string }[]; href: string };
export type TodayPromise = { id: number; personId: number; personName: string; text: string; due: string; mine: boolean; overdue: boolean };
export type TodayLearned = { id: number; personId: number; personName: string; text: string };
export type TodayNews = { count: number; top: { id: number; title: string; url: string; source: string }[] };

export type TodayData = { appointments: TodayAppointment[]; due: TodoView[]; promises: TodayPromise[]; learned: TodayLearned[]; news: TodayNews | null };

/** Tomorrow's appointments until this time count as "tomorrow morning". */
const MORNING_END = "12:00";

/** Today's appointments still to come (or running) and tomorrow morning's, of the calendars shown — not suggestions, not cancelled. */
async function appointments(now: Date): Promise<TodayAppointment[]> {
  if (!isInstalled("calendar")) return [];
  const { eventsBetween } = await import("@/lib/calendar/ir");
  const today = dayOf(now);
  const tomorrow = dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const events = eventsBetween(stampOf(now), `${tomorrow}T${MORNING_END}`, { visible: true }).filter((e) => !e.cancelled && !e.calendar.shadow && !(e.allDay && e.start < today));
  const people = isInstalled("people") ? (await import("@/plugins/people/store")).listPeople() : [];
  const { withThem } = await import("@/plugins/people/appointments");
  return events.map((e) => ({
    id: e.id,
    title: e.title,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    location: e.location,
    online: e.online,
    tomorrow: e.start.slice(0, 10) > today,
    people: people.filter((p) => withThem(p, e)).map((p) => ({ id: p.id, name: p.name })),
    href: `/kalender?v=day&d=${e.start.slice(0, 10)}`,
  }));
}

/** Your open todos (not a worker's) due today or before — the oldest first. */
async function dueTodos(today: string): Promise<TodoView[]> {
  const { listTodos } = await import("@/lib/todos/store");
  return listTodos({ status: "open" })
    .filter((x) => x.owner === "me" && !x.byWorker && x.due && x.due.slice(0, 10) <= today)
    .sort((a, b) => a.due!.localeCompare(b.due!));
}

/** What you promised, due today or before; what was promised to you, past its day — the oldest first. */
async function promises(today: string): Promise<TodayPromise[]> {
  if (!isInstalled("people")) return [];
  const { openCommitments } = await import("@/plugins/people/graph");
  return openCommitments()
    .filter((c) => c.due && (c.direction === "mine" ? c.due <= today : c.direction === "theirs" && c.due < today))
    .sort((a, b) => a.due.localeCompare(b.due))
    .map((c) => ({ id: c.id, personId: c.personId, personName: c.personName, text: c.text, due: c.due, mine: c.direction === "mine", overdue: c.due < today }));
}

/** What was learned about people since `since` (to confirm in the review queue). */
async function learned(since: string): Promise<TodayLearned[]> {
  if (!isInstalled("people")) return [];
  const { proposedClaims } = await import("@/plugins/people/graph");
  return proposedClaims()
    .filter((c) => c.createdAt >= since)
    .map((c) => ({ id: c.id, personId: c.personId, personName: c.personName, text: c.text }));
}

/** The news since `since`: how many, and the best few not seen yet (with the funnel: what the AI let through). */
async function news(since: string): Promise<TodayNews | null> {
  if (!isInstalled("news")) return null;
  const { countNewSince, listItems } = await import("@/plugins/news/store");
  const count = countNewSince(since);
  const top = listItems({ view: "foryou", maxAgeDays: 1, limit: 3 })
    .filter((i) => !i.seen)
    .map((i) => ({ id: i.id, title: i.title, url: i.url, source: i.sourceName }));
  return { count, top };
}

export async function todayData(now: Date = new Date()): Promise<TodayData> {
  const today = dayOf(now);
  const since = new Date(now.getTime() - 864e5).toISOString();
  return { appointments: await appointments(now), due: await dueTodos(today), promises: await promises(today), learned: await learned(since), news: await news(since) };
}
