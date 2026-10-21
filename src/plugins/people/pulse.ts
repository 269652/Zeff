import { getSqlite } from "@/db";
import { getPref, setPref } from "@/lib/prefs";
import { isInstalled } from "@/plugins/state";
import { withThem } from "./appointments";
import { claimsOf, openCommitments, proposedClaims, proposedLinks, reviewClaim, reviewLink } from "./graph";
import type { Circle, Person } from "./shared";
import { contactsOf, getPerson, listPeople, namesOf, relationsOf, setCircle } from "./store";

/**
 * The pulse of your people (the People plugin): when you were last in touch with each — their chat either way, a mail thread
 * with them, Teams, an appointment that's over — and who you haven't heard of for a while (the starred, family and friends);
 * the circle each is in by rule; the confident claims taken at once; who to compile again; and a brief before an appointment
 * with someone. Server only.
 */

export type Channel = "WhatsApp" | "Signal" | "Mail" | "Teams" | "Appointment";
export type LastContact = { at: string; channel: Channel };

const DAY = 864e5;
const pad = (n: number) => String(n).padStart(2, "0");
/** A local time as the calendar keeps it: "YYYY-MM-DDTHH:MM". */
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** A calendar time ("YYYY-MM-DDTHH:MM", local) as an instant (ISO). */
const instant = (s: string) => new Date(s.length === 10 ? `${s}T00:00` : s).toISOString();

/** The past appointments (a year back) — read once for everyone. */
async function pastEvents(now: Date) {
  if (!isInstalled("calendar")) return [];
  const { eventsBetween } = await import("@/lib/calendar/ir");
  return eventsBetween(local(new Date(now.getTime() - 365 * DAY)), local(now)).filter((e) => !e.cancelled && (e.end.length === 10 ? `${e.end}T00:00` : e.end) <= local(now));
}

function chatLast(d: ReturnType<typeof getSqlite>, p: Person, now: string): LastContact | null {
  let best: LastContact | null = null;
  const take = (at: string | null | undefined, channel: Channel) => {
    if (at && at <= now && (!best || at > best.at)) best = { at, channel };
  };
  const one = (sql: string, ...args: unknown[]) => (d.prepare(sql).get(...args) as { at: string | null } | undefined)?.at;
  const names = namesOf(p);
  // Their chats, either way: WhatsApp (the one set, else one named like them), Signal (named like them).
  for (const n of p.whatsapp ? [p.whatsapp, ...names] : names) take(one("select max(received_at) at from emails where conv_id = ? and received_at <= ?", `wa:${n}`, now), "WhatsApp");
  for (const n of names) take(one("select max(received_at) at from emails where conv_id = ? and received_at <= ?", `sg:${n}`, now), "Signal");
  // A mail thread with them: any mail in a thread they wrote in (your answers too).
  for (const mail of p.emails) {
    take(one("select max(received_at) at from emails where received_at <= ? and conv_id in (select conv_id from emails where lower(from_email) = lower(?)) and folder not in ('WhatsApp', 'Signal')", now, mail), "Mail");
  }
  if (names.length) {
    try {
      take(one(`select max(sent_at) at from teams_messages where sent_at <= ? and (${names.map(() => "sender_name = ? collate nocase").join(" or ")})`, now, ...names), "Teams");
    } catch {
      // no Teams kept
    }
  }
  return best;
}

/** When you were last in touch with each of them (none: nothing known). `now`: what counts as past. */
export function lastContacts(people: Person[], now = new Date(), events: { title: string; description: string; attendees: string[]; organizer: string; start: string }[] | null = null): Map<number, LastContact> {
  const d = getSqlite();
  const at = now.toISOString();
  const out = new Map<number, LastContact>();
  for (const p of people) {
    let best: LastContact | null = null;
    try {
      best = chatLast(d, p, at);
    } catch {
      // no messages kept (the plugins never ran)
    }
    for (const e of events ?? []) {
      const when = instant(e.start);
      if (when <= at && (!best || when > best.at) && withThem(p, e)) best = { at: when, channel: "Appointment" };
    }
    if (best) out.set(p.id, best);
  }
  return out;
}

/** The same with the calendar read (the appointments that are over). */
export async function lastContactsAll(people: Person[] = listPeople(), now = new Date()): Promise<Map<number, LastContact>> {
  return lastContacts(people, now, await pastEvents(now));
}

// ---------------------------------------------------------------------------
// Getting in touch
// ---------------------------------------------------------------------------

const WEEKS = "people.nudgeWeeks";
const SNOOZE = "people.nudgeSnooze";

/** After how many weeks without contact a person you care about comes up (default 6). */
export const nudgeWeeks = (): number => getPref<number>(WEEKS, 6);
export const setNudgeWeeks = (weeks: number) => setPref(WEEKS, Math.max(1, Math.min(52, Math.round(weeks) || 6)));

/** Not asked about them for `days` (a "Later"). */
export function snoozeNudge(personId: number, days: number, now = new Date()): void {
  const all = getPref<Record<string, string>>(SNOOZE, {});
  setPref(SNOOZE, { ...all, [personId]: new Date(now.getTime() + days * DAY).toISOString() });
}

export type Nudge = { personId: number; name: string; at: string; channel: Channel; days: number };

/** Who you care about (starred, family, friends) and haven't been in touch with for `weeks` — the longest first. A person never heard of isn't asked about. */
export function nudges(opts: { now?: Date; weeks?: number; contacts?: Map<number, LastContact> } = {}): Nudge[] {
  const now = opts.now ?? new Date();
  const weeks = opts.weeks ?? nudgeWeeks();
  const snoozed = getPref<Record<string, string>>(SNOOZE, {});
  const people = listPeople().filter((p) => p.starred || p.circle === "family" || p.circle === "friends");
  const last = opts.contacts ?? lastContacts(people, now);
  const me = new Set(myNames());
  return people
    .flatMap((p) => {
      const c = last.get(p.id);
      if (!c || me.has(p.name.toLowerCase()) || (snoozed[p.id] && snoozed[p.id] > now.toISOString())) return [];
      const days = Math.floor((now.getTime() - Date.parse(c.at)) / DAY);
      return days >= weeks * 7 ? [{ personId: p.id, name: p.name, at: c.at, channel: c.channel, days }] : [];
    })
    .sort((a, b) => b.days - a.days);
}

// ---------------------------------------------------------------------------
// Circles by rule
// ---------------------------------------------------------------------------

const MY_NAME = "people.myName";
/** Your name as you set it (the People overview's tools) — "" not set. */
export const myName = (): string => getPref<string>(MY_NAME, "");
export const setMyName = (name: string) => setPref(MY_NAME, name.trim().slice(0, 120));

/** Your own names (lower case): the one you set, your Jira name, and the name your sent mails go out under. */
export function myNames(): string[] {
  const out = new Set<string>();
  if (myName()) out.add(myName().toLowerCase());
  try {
    const jira = getSqlite().prepare("select assignee from jira_tickets where mine = 1 and assignee is not null limit 1").get() as { assignee: string } | undefined;
    if (jira?.assignee) out.add(jira.assignee.trim().toLowerCase());
  } catch {
    // no Jira kept
  }
  try {
    for (const r of getSqlite().prepare("select from_name, count(*) n from emails where (folder like '%Sent%' or folder like '%Gesendet%') and from_name is not null and from_name != 'Ich' group by from_name order by n desc limit 2").all() as { from_name: string }[]) out.add(r.from_name.trim().toLowerCase());
  } catch {
    // no mails kept
  }
  return [...out].filter(Boolean);
}

const FAMILY = /\b(mutter|vater|mama|papa|eltern|bruder|schwester|geschwister|sohn|tochter|kind|onkel|tante|oma|opa|gro(ß|ss)(mutter|vater|eltern)|enkel\w*|cousine?|nichte|neffe|schwager|schwägerin|schwieger\w+|ehefrau|ehemann|mother|father|mum|mom|dad|sister|brother|son|daughter|aunt|uncle|grand\w+|cousin|niece|nephew|wife|husband)\b|\bmein(e)?\s+(frau|mann|partner(in)?)\b/i;
const FRIENDS = /\b(freund(in)?|kumpel|bekannte?r?|friend|buddy|mitbewohner(in)?)\b/i;
const WORK = /\b(kolleg(e|in)|chef(in)?|vorgesetzte?r?|teamleiter(in)?|kunde|kundin|auftraggeber(in)?|colleague|boss|manager|client)\b/i;
const AUTHORITY = /(justiz|gericht|finanzamt|\.gov\b|bund\.de|landkreis|landratsamt|stadt-|rathaus|beitragsservice|jobcenter|arbeitsagentur|polizei|inkasso|krankenkasse|\baok\b|\btk\.de|rentenversicherung)/i;

export type CircleContext = { me: string[]; teams?: Set<string>; cases?: Set<number> };

/** Their circle by what Zeff knows for sure — "" when nothing says it (the AI decides then). */
export function ruleCircle(p: Person, ctx: CircleContext): Circle | "" {
  const rels = relationsOf(p.id).out.map((r) => r.rel);
  if (rels.some((r) => FAMILY.test(r))) return "family";
  if (ctx.cases?.has(p.id) || p.emails.some((m) => AUTHORITY.test(m.split("@")[1] ?? ""))) return "authorities";
  // Your last name (not you): family.
  const last = (n: string) => n.trim().split(/\s+/).at(-1)?.toLowerCase() ?? "";
  const mine = ctx.me.filter((n) => n.includes(" ")).map(last);
  if (p.name.trim().includes(" ") && !ctx.me.includes(p.name.toLowerCase()) && mine.includes(last(p.name))) return "family";
  if (rels.some((r) => FRIENDS.test(r))) return "friends";
  if (rels.some((r) => WORK.test(r)) || p.accounts.some((a) => a.kind === "jira") || namesOf(p).some((n) => ctx.teams?.has(n.toLowerCase()))) return "work";
  return "";
}

/** Everyone's circle by rule (what you or the AI set stays). How many changed. */
export function applyCircleRules(): number {
  const d = getSqlite();
  let teams = new Set<string>();
  try {
    teams = new Set((d.prepare("select distinct lower(sender_name) n from teams_messages where sender_name is not null").all() as { n: string }[]).map((r) => r.n));
  } catch {
    // no Teams kept
  }
  let cases = new Set<number>();
  if (isInstalled("cases")) {
    try {
      cases = new Set((d.prepare("select distinct person_id id from cases where person_id is not null and status != 'ignored'").all() as { id: number }[]).map((r) => r.id));
    } catch {
      // no cases yet
    }
  }
  const ctx: CircleContext = { me: myNames(), teams, cases };
  let n = 0;
  for (const p of listPeople()) {
    if (p.circleSource === "manual" || p.circleSource === "ai") continue;
    const c = ruleCircle(p, ctx);
    if (c && setCircle(p.id, c, "rule")) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// The confident ones, and who to compile again
// ---------------------------------------------------------------------------

/** The claims and links the AI is sure of (from `min` on) confirmed at once — identity suggestions always wait for you. */
export function acceptConfident(min = 0.9): { claims: number; links: number } {
  const claims = proposedClaims().filter((c) => c.confidence >= min && !(c.kind === "commitment" && c.doneAt));
  for (const c of claims) reviewClaim(c.id, "confirm");
  const links = proposedLinks().filter((l) => l.confidence >= min);
  for (const l of links) reviewLink(l.id, "confirm");
  return { claims: claims.length, links: links.length };
}

/** Who to compile (again): never compiled but something is known of them, or something new since (a claim, a contact). */
export function staleForCompile(now = new Date(), contacts?: Map<number, LastContact>): number[] {
  const people = listPeople();
  const last = contacts ?? lastContacts(people, now);
  return people
    .filter((p) => {
      const claims = claimsOf(p.id);
      const newest = [last.get(p.id)?.at ?? "", ...claims.map((c) => c.createdAt)].sort().at(-1) ?? "";
      const known = !!newest || !!p.note.trim() || relationsOf(p.id).out.length > 0;
      if (!known) return false;
      return !p.compiled || newest > p.compiled.at;
    })
    .map((p) => p.id);
}

// ---------------------------------------------------------------------------
// Before an appointment
// ---------------------------------------------------------------------------

export type MeetingBrief = {
  personId: number;
  name: string;
  eventId: number;
  title: string;
  start: string;
  /** The appointment with them before (null: none in the last year). */
  lastMet: string | null;
  /** What came from them since you last met (or in the last 30 days). */
  since: { at: string; text: string }[];
  owed: { direction: "mine" | "theirs"; text: string; due: string }[];
  cases: { label: string; title: string; open: number | null; nextDue: string | null }[];
};

/** The appointments with someone in the next 24 hours — a brief for each person in them. */
export async function meetingBriefs(now = new Date()): Promise<MeetingBrief[]> {
  if (!isInstalled("calendar")) return [];
  const { eventsBetween } = await import("@/lib/calendar/ir");
  const coming = eventsBetween(local(now), local(new Date(now.getTime() + DAY))).filter((e) => !e.cancelled && (e.end.length === 10 ? `${e.end}T00:00` : e.end) > local(now));
  if (!coming.length) return [];
  const past = await pastEvents(now);
  const me = new Set(myNames());
  const people = listPeople().filter((p) => !me.has(p.name.toLowerCase()));
  const owedAll = openCommitments();
  const out: MeetingBrief[] = [];
  for (const e of coming) {
    for (const p of people.filter((x) => withThem(x, e))) {
      const before = past.filter((x) => withThem(p, x)).sort((a, b) => b.start.localeCompare(a.start))[0];
      const from = before ? instant(before.start) : new Date(now.getTime() - 30 * DAY).toISOString();
      let cases: MeetingBrief["cases"] = [];
      if (isInstalled("cases")) {
        const { casesOfPerson } = await import("@/plugins/cases/store");
        const { caseTitle } = await import("@/plugins/cases/shared");
        cases = casesOfPerson(p.id)
          .filter((c) => c.status === "open" && !c.compiled?.done)
          .map((c) => ({ label: c.label, title: caseTitle(c), open: c.compiled?.open ?? null, nextDue: c.compiled?.nextDue ?? null }));
      }
      out.push({
        personId: p.id,
        name: p.name,
        eventId: e.id,
        title: e.title,
        start: e.start,
        lastMet: before ? instant(before.start) : null,
        since: contactsOf(p, 20)
          .filter((c) => c.at > from && c.at <= now.toISOString())
          .slice(0, 3)
          .map((c) => ({ at: c.at, text: c.text })),
        owed: owedAll.filter((c) => c.personId === p.id && (c.direction === "mine" || c.direction === "theirs")).map((c) => ({ direction: c.direction as "mine" | "theirs", text: c.text, due: c.due })),
        cases,
      });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** A person as the pulse needs them (for the actions). */
export const personForPulse = (id: number) => getPerson(id);

/**
 * After each briefing (the People matching step): everyone's circle by rule, and — with the LLM plugin — the summaries that
 * are missing or out of date compiled in the background. How many circles changed and how many are compiled.
 */
export async function afterBriefing(now = new Date()): Promise<{ circles: number; compiling: number }> {
  const circles = applyCircleRules();
  if (!isInstalled("llm")) return { circles, compiling: 0 };
  const ids = staleForCompile(now, await lastContactsAll(listPeople(), now));
  if (!ids.length) return { circles, compiling: 0 };
  const { startCompile } = await import("./compile");
  return { circles, compiling: startCompile({ ids }) ? ids.length : 0 };
}
