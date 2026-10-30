import { getSqlite } from "@/db";
import { t } from "@/lib/i18n/server";
import { ME_SENDER } from "@/lib/mail/shared";
import type { SeriesProvider } from "@/plugins/correlations/series-point";
import { isInstalled } from "@/plugins/state";
import { withThem } from "./appointments";
import type { Channel } from "./pulse";
import type { Person } from "./shared";
import { listPeople, namesOf } from "./store";
import { localStamp } from "@/lib/dates";

/**
 * The rhythm of a relationship (the People plugin's pulse, more than the last contact): over the last 12 months, on how many days you
 * were in touch with someone and on which channels; how far apart those days usually are (the median gap) and how far beyond that the
 * silence now is (the drift — days since the last contact over the usual gap); who starts a conversation (the first message after 8
 * hours of quiet in that chat — yours or theirs); and how long each side takes to answer (the median). Pure functions over a plain list
 * of messages, and a thin reader that gathers a person's list from the chats, the mail threads, Teams and the appointments over. Server
 * only (the reader); the functions take nothing from the database.
 */

/**
 * One contact with them: when (ISO), on which channel — and, where it is a two-sided conversation, whose it is and which chat or thread
 * (`conv`). Without `conv` or `mine` (an appointment, a message of theirs in a group) it counts as a day in touch only — not for who
 * starts and how fast one answers.
 */
export type PulseMessage = { at: string; channel: Channel; mine?: boolean; conv?: string };

export type PulseInsight = {
  /** Days in touch (local days with any contact), and per channel. */
  contactDays: number;
  byChannel: Partial<Record<Channel, number>>;
  firstDay: string | null;
  lastDay: string | null;
  /** The usual gap between two days in touch (the median, in days) — null under two days. */
  typicalGap: number | null;
  /** Whole days since the last day in touch (0: today). */
  daysSince: number | null;
  /** Days since over the usual gap: 1 is on rhythm, 3 three times as long as usual. */
  drift: number | null;
  /** Well beyond the usual rhythm, with history enough to know one (see DRIFT). */
  drifting: boolean;
  /** Conversations started (after 8 hours of quiet): yours, theirs, your share (null: none). */
  initiative: { mine: number; theirs: number; share: number | null };
  /** The median time to answer, in minutes: yours to them, theirs to you (null: no answer seen). */
  reply: { mine: number | null; theirs: number | null };
};

const DAY = 864e5;
const HOUR = 36e5;
/** Quiet this long in a chat and the next message starts a new conversation. */
export const QUIET_HOURS = 8;
/** An answer later than this isn't one (a new start instead) — it would only spoil the median. */
const MAX_REPLY = 7 * DAY;
/**
 * Drifting: at least this many days in touch (a rhythm to speak of), the silence at least `factor` times the usual gap and a week
 * at least (someone you write daily isn't drifting after two quiet days).
 */
export const DRIFT = { minDays: 4, factor: 2, minSilence: 7 };
/** The window the insights look at. */
export const PULSE_MONTHS = 12;

/** A moment's local day ("YYYY-MM-DD"). */
export const dayOf = (at: string | Date): string => (typeof at === "string" ? new Date(at) : at).toLocaleDateString("sv-SE");
/** Whole days from one local day to another. */
const daysFrom = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / DAY);

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The days in touch, sorted, and how many per channel (a day on two channels counts for both). */
export function contactDays(msgs: PulseMessage[]): { days: string[]; byChannel: Partial<Record<Channel, number>> } {
  const all = new Set<string>();
  const per = new Map<Channel, Set<string>>();
  for (const m of msgs) {
    const day = dayOf(m.at);
    all.add(day);
    if (!per.has(m.channel)) per.set(m.channel, new Set());
    per.get(m.channel)!.add(day);
  }
  return { days: [...all].sort(), byChannel: Object.fromEntries([...per].map(([c, s]) => [c, s.size])) };
}

/** The usual gap between days in touch (sorted days): the median of the gaps, null under two days. */
export const typicalGap = (days: string[]): number | null => median(days.slice(1).map((d, i) => daysFrom(days[i], d)));

/** The conversations, each sorted: only the two-sided messages (with `conv` and `mine`). */
function conversations(msgs: PulseMessage[]): PulseMessage[][] {
  const by = new Map<string, PulseMessage[]>();
  for (const m of msgs) if (m.conv && m.mine !== undefined) by.set(m.conv, [...(by.get(m.conv) ?? []), m]);
  return [...by.values()].map((list) => list.sort((a, b) => a.at.localeCompare(b.at)));
}

/** Who starts: the first message of a chat (in what was read) and each after `QUIET_HOURS` of quiet in it — yours or theirs. */
export function initiative(msgs: PulseMessage[]): PulseInsight["initiative"] {
  let mine = 0;
  let theirs = 0;
  for (const list of conversations(msgs)) {
    list.forEach((m, i) => {
      if (i > 0 && Date.parse(m.at) - Date.parse(list[i - 1].at) < QUIET_HOURS * HOUR) return;
      if (m.mine) mine++;
      else theirs++;
    });
  }
  return { mine, theirs, share: mine + theirs ? mine / (mine + theirs) : null };
}

/**
 * How fast each side answers: where a chat turns from one side to the other, the time from the first message of the other side's run
 * (how long it waited) to the answer. A turn within the conversation (under `QUIET_HOURS` since the last message) is always an
 * answer; a later one only when the run it follows opened a conversation (a question left waiting) — after an answer it is a new
 * start, not an answer to the answer. Over a week isn't an answer either. The medians in minutes: yours (you answering them), theirs.
 */
export function replyTimes(msgs: PulseMessage[]): PulseInsight["reply"] {
  const mine: number[] = [];
  const theirs: number[] = [];
  for (const list of conversations(msgs)) {
    let runStart = list[0];
    let runOpened = true;
    list.forEach((m, i) => {
      if (i === 0) return;
      const quiet = Date.parse(m.at) - Date.parse(list[i - 1].at) >= QUIET_HOURS * HOUR;
      if (m.mine === runStart.mine) {
        // The same side again after the quiet: a new start — an answer to it waits from here.
        if (quiet) [runStart, runOpened] = [m, true];
        return;
      }
      const wait = Date.parse(m.at) - Date.parse(runStart.at);
      if ((!quiet || runOpened) && wait >= 0 && wait <= MAX_REPLY) (m.mine ? mine : theirs).push(wait / 6e4);
      // The new run: an opener of its own when it came after the quiet (see initiative).
      runStart = m;
      runOpened = quiet;
    });
  }
  const round = (n: number | null) => (n === null ? null : Math.round(n));
  return { mine: round(median(mine)), theirs: round(median(theirs)) };
}

/** Everything at once, for one person's messages; `now` the day the silence is counted to. */
export function pulseInsight(msgs: PulseMessage[], now = new Date()): PulseInsight {
  const past = msgs.filter((m) => Date.parse(m.at) <= now.getTime());
  const { days, byChannel } = contactDays(past);
  const lastDay = days.at(-1) ?? null;
  const gap = typicalGap(days);
  const daysSince = lastDay ? daysFrom(lastDay, dayOf(now)) : null;
  // (A gap under a day can't be — days are whole; a burst on consecutive days has 1.)
  const drift = gap && daysSince !== null ? Math.round((daysSince / gap) * 10) / 10 : null;
  return {
    contactDays: days.length,
    byChannel,
    firstDay: days[0] ?? null,
    lastDay,
    typicalGap: gap,
    daysSince,
    drift,
    drifting: days.length >= DRIFT.minDays && drift !== null && drift >= DRIFT.factor && daysSince! >= DRIFT.minSilence,
    initiative: initiative(past),
    reply: replyTimes(past),
  };
}

// ---------------------------------------------------------------------------
// Reading a person's messages
// ---------------------------------------------------------------------------

type Event = { title: string; description: string; attendees: string[]; organizer: string; start: string; end: string; cancelled: boolean };

/** The appointments in a period (none without the Calendar plugin) — read once for everyone. */
export async function eventsIn(from: Date, to: Date): Promise<Event[]> {
  if (!isInstalled("calendar")) return [];
  const { eventsBetween } = await import("@/lib/calendar/ir");
  return eventsBetween(localStamp(from), localStamp(to)).filter((e) => !e.cancelled);
}

/** The one sender of Teams' chats that is you: who wrote in chats but never a personal message or a mention to you (as the signals take it). */
function ownTeamsSender(): string | null {
  try {
    const r = getSqlite()
      .prepare("select sender_id s, count(*) n from teams_messages where kind = 'chat' and sender_id is not null and sender_id not in (select sender_id from teams_messages where kind <> 'chat' and sender_id is not null) group by sender_id order by n desc limit 1")
      .get() as { s: string } | undefined;
    return r?.s ?? null;
  } catch {
    return null;
  }
}

/**
 * Their messages and yours between `from` and `to` (ISO), as the last contact reads them (pulse.ts): their WhatsApp chat (the one set,
 * else one named like them) and their Signal chat — not a group; the mail threads they wrote in (theirs by their address, yours by
 * the sender "Ich" or a sent folder; someone else's mail in the thread a day in touch only); Teams (theirs by their name — in a chat of
 * only the two of you yours too); the appointments with them that are over (`events`, a day in touch only).
 */
export function pulseMessages(p: Person, from: string, to: string, events: Event[] = [], own: string | null = ownTeamsSender()): PulseMessage[] {
  const d = getSqlite();
  const out: PulseMessage[] = [];
  const names = namesOf(p);
  const seen = new Set<string>();
  type Row = { key: string; conv_id: string; folder: string; from_name: string | null; from_email: string | null; received_at: string };
  const chat = (convs: string[], channel: Channel) => {
    if (!convs.length) return;
    const rows = d.prepare(`select key, conv_id, folder, from_name, from_email, received_at from emails where conv_id in (${convs.map(() => "?").join(", ")}) and coalesce(is_group, 0) = 0 and received_at >= ? and received_at <= ?`).all(...convs, from, to) as Row[];
    for (const r of rows) if (!seen.has(r.key) && seen.add(r.key)) out.push({ at: r.received_at, channel, mine: r.from_name === ME_SENDER, conv: r.conv_id });
  };
  try {
    chat([...new Set(p.whatsapp ? [p.whatsapp, ...names] : names)].map((n) => `wa:${n}`), "WhatsApp");
    chat(names.map((n) => `sg:${n}`), "Signal");
    const theirs = new Set(p.emails.map((m) => m.toLowerCase()));
    for (const mail of p.emails) {
      const rows = d
        .prepare("select key, conv_id, folder, from_name, from_email, received_at from emails where received_at >= ? and received_at <= ? and conv_id in (select conv_id from emails where lower(from_email) = lower(?)) and folder not in ('WhatsApp', 'Signal')")
        .all(from, to, mail) as Row[];
      for (const r of rows) {
        if (seen.has(r.key)) continue;
        seen.add(r.key);
        const isTheirs = theirs.has((r.from_email ?? "").toLowerCase());
        const isMine = r.from_name === ME_SENDER || /sent|gesendet/i.test(r.folder);
        out.push(isTheirs || isMine ? { at: r.received_at, channel: "Mail", mine: !isTheirs, conv: r.conv_id } : { at: r.received_at, channel: "Mail" });
      }
    }
  } catch {
    // no messages kept (the plugins never ran)
  }
  if (names.length) {
    try {
      type T = { key: string; conversation_id: string; sender_name: string | null; sender_id: string | null; sent_at: string };
      const isThem = (n: string | null) => !!n && names.some((x) => x.toLowerCase() === n.toLowerCase());
      const convs = (d.prepare(`select distinct conversation_id c from teams_messages where sent_at >= ? and sent_at <= ? and (${names.map(() => "sender_name = ? collate nocase").join(" or ")})`).all(from, to, ...names) as { c: string }[]).map((r) => r.c);
      for (const c of convs) {
        const rows = d.prepare("select key, conversation_id, sender_name, sender_id, sent_at from teams_messages where conversation_id = ? and sent_at >= ? and sent_at <= ?").all(c, from, to) as T[];
        // Only the two of you in it: a conversation of yours with them; else (a group) only their messages, as days in touch.
        const twoOfYou = rows.every((r) => isThem(r.sender_name) || (!!own && r.sender_id === own));
        for (const r of rows) {
          const mine = !!own && r.sender_id === own;
          if (twoOfYou) out.push({ at: r.sent_at, channel: "Teams", mine, conv: `teams:${c}` });
          else if (isThem(r.sender_name)) out.push({ at: r.sent_at, channel: "Teams" });
        }
      }
    } catch {
      // no Teams kept
    }
  }
  for (const e of events) {
    const start = new Date(e.start.length === 10 ? `${e.start}T00:00` : e.start);
    const end = e.end.length === 10 ? `${e.end}T00:00` : e.end;
    if (start.toISOString() >= from && end <= localStamp(new Date(to)) && withThem(p, e)) out.push({ at: start.toISOString(), channel: "Appointment" });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** The 12 months before `now`, as ISO. */
const lastYear = (now: Date) => ({ from: new Date(now.getTime() - 365 * DAY).toISOString(), to: now.toISOString() });

/** One person's insight over the last 12 months. */
export async function personPulse(p: Person, now = new Date()): Promise<PulseInsight> {
  const w = lastYear(now);
  return pulseInsight(pulseMessages(p, w.from, w.to, await eventsIn(new Date(w.from), now)), now);
}

/** Whom the insights are about: people (not organisations), not you. */
async function others(): Promise<Person[]> {
  const { myNames } = await import("./pulse");
  const me = new Set(myNames());
  return listPeople().filter((p) => p.kind !== "organization" && !me.has(p.name.toLowerCase()));
}

export type Drifting = { personId: number; name: string; typicalGap: number; daysSince: number; drift: number; lastDay: string };

/** The people drifting away — well beyond their usual rhythm (see DRIFT) — the furthest first. */
export async function driftingPeople(now = new Date(), people?: Person[]): Promise<Drifting[]> {
  const list = people ?? (await others());
  const w = lastYear(now);
  const events = await eventsIn(new Date(w.from), now);
  const own = ownTeamsSender();
  return list
    .flatMap((p) => {
      const x = pulseInsight(pulseMessages(p, w.from, w.to, events, own), now);
      return x.drifting ? [{ personId: p.id, name: p.name, typicalGap: x.typicalGap!, daysSince: x.daysSince!, drift: x.drift!, lastDay: x.lastDay! }] : [];
    })
    .sort((a, b) => b.drift - a.drift);
}

/**
 * The days in touch per person in a period of days ("YYYY-MM-DD", inclusive) — for the Correlations' series: the `top` people with the
 * most days in it, each with their days (read from 90 days before it, so a first contact before the period starts it at its first day).
 */
export async function contactDaysByPerson(range: { from: string; to: string }, top = 12, people?: Person[]): Promise<{ person: Person; days: string[]; first: string }[]> {
  const list = people ?? (await others());
  const from = new Date(Date.parse(`${range.from}T00:00:00`) - 90 * DAY);
  const to = new Date(Date.parse(`${range.to}T23:59:59`));
  const events = await eventsIn(from, to);
  const own = ownTeamsSender();
  return list
    .map((person) => {
      const { days } = contactDays(pulseMessages(person, from.toISOString(), to.toISOString(), events, own));
      return { person, days, first: days[0] ?? "", inRange: days.filter((d) => d >= range.from && d <= range.to).length };
    })
    .filter((x) => x.inRange > 0)
    .sort((a, b) => b.inRange - a.inRange || a.person.name.localeCompare(b.person.name))
    .slice(0, top)
    .map(({ person, days, first }) => ({ person, days, first }));
}

// ---------------------------------------------------------------------------
// For the Correlations: a day with them or without
// ---------------------------------------------------------------------------

/**
 * A daily series per person you are most in touch with (the 12 with the most days in the period): 1 on a day in touch with them, 0
 * on a day without — from their first contact on (before it there's nothing to say). The Correlations then compare a journal's mood
 * and energy on days with them and without. Personal (lib/boundaries: the channels they are read from — correlations/boundaries.ts).
 */
export const PEOPLE_SERIES: SeriesProvider = {
  id: "people.contact",
  series: async (range) => {
    const { filled } = await import("@/plugins/correlations/days");
    const group = t("People");
    return (await contactDaysByPerson(range)).map(({ person, days, first }) => ({
      id: `people:${person.id}:contact`,
      label: t("Contact with {name}", { name: person.name }),
      group,
      kind: "binary" as const,
      values: filled(new Map(days.map((d) => [d, 1])), range, first),
    }));
  },
};
