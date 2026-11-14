import { getSqlite } from "@/db";
import { eventsBetween } from "@/lib/calendar/ir";
import { isSleepCalendar } from "@/plugins/calendar/sleep-series";
import { t } from "@/lib/i18n/server";
import { ME_SENDER } from "@/lib/mail/shared";
import { isInstalled } from "@/plugins/state";
import { filled, localDate, localDay } from "./days";
import type { Series, SeriesInfo, SeriesProvider, SeriesRange } from "./series-point";
import { addDays } from "@/lib/dates";

/**
 * Zeff's own signals as daily series, read where they live: meeting hours (the calendars that block time, overlaps counted once, not
 * declined, cancelled, free or all-day), booked hours, messages received and sent per channel (mail, WhatsApp, Signal, Teams), todos
 * made and done, spending (the bank's bookings), and the first and last thing you did that day (a message of yours, booked time with
 * its start). Each from its first record on — a day without anything is a 0 then, before it there's nothing to say. Server only.
 */

const db = () => getSqlite();
const count = (rows: { day: string | null }[]) => {
  const m = new Map<string, number>();
  for (const r of rows) if (r.day) m.set(r.day, (m.get(r.day) ?? 0) + 1);
  return m;
};
const hasTable = (name: string) => !!db().prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(name);
/** A day before the period for its stamps in UTC (a local day can start the evening before in UTC). */
const isoFrom = (range: SeriesRange) => `${addDays(range.from, -2)}`;
const isoTo = (range: SeriesRange) => `${addDays(range.to, 2)}`;

function meetingHours(range: SeriesRange): Series[] {
  const first = (db().prepare("select min(start) s from calendar_events where all_day = 0 and cancelled = 0").get() as { s: string | null }).s;
  if (!first) return [];
  const events = eventsBetween(`${range.from}T00:00`, `${addDays(range.to, 1)}T00:00`, { busy: true }).filter(
    // (A sleep tracker's calendar blocks the night — no meeting.)
    (e) => !e.allDay && !e.cancelled && e.showAs !== "free" && e.response !== "declined" && !isSleepCalendar(e.calendar.name),
  );
  // Per day: the union of its meetings (two at once count once), cut to the day.
  const byDay = new Map<string, [number, number][]>();
  const minutes = (s: string) => Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16));
  for (const e of events) {
    for (let day = e.start.slice(0, 10); day <= e.end.slice(0, 10); day = addDays(day, 1)) {
      const a = day === e.start.slice(0, 10) ? minutes(e.start) : 0;
      const b = day === e.end.slice(0, 10) ? minutes(e.end) : 1440;
      if (b > a) byDay.set(day, [...(byDay.get(day) ?? []), [a, b]]);
    }
  }
  const hours = new Map<string, number>();
  for (const [day, spans] of byDay) {
    spans.sort((x, y) => x[0] - y[0]);
    let total = 0;
    let [cs, ce] = spans[0];
    for (const [s, e] of spans.slice(1)) {
      if (s <= ce) ce = Math.max(ce, e);
      else {
        total += ce - cs;
        [cs, ce] = [s, e];
      }
    }
    total += ce - cs;
    hours.set(day, total / 60);
  }
  return [{ id: "calendar:meeting-hours", label: t("Meeting hours"), group: t("Calendar"), kind: "number", unit: "h", values: filled(hours, range, first.slice(0, 10)) }];
}

function bookedHours(range: SeriesRange): Series[] {
  if (!isInstalled("zeiterfassung")) return [];
  const first = (db().prepare("select min(date) d from time_entries").get() as { d: string | null }).d;
  const rows = db().prepare("select date, sum(hours) h from time_entries where date between ? and ? group by date").all(range.from, range.to) as { date: string; h: number }[];
  return [{ id: "time:booked-hours", label: t("Booked hours"), group: t("Time tracking"), kind: "number", unit: "h", values: filled(new Map(rows.map((r) => [r.date, r.h])), range, first) }];
}

type Msg = { at: Date; day: string; mine: boolean; channel: string };

/** Messages of every channel, each with its local day and whether it is yours. */
function messages(range: SeriesRange): { list: Msg[]; first: Map<string, string> } {
  const list: Msg[] = [];
  const first = new Map<string, string>();
  const channelOf = (folder: string) => (folder === "WhatsApp" ? "whatsapp" : folder === "Signal" ? "signal" : "mail");
  for (const r of db().prepare("select folder, min(received_at) at from emails group by folder").all() as { folder: string; at: string }[]) {
    const day = localDay(r.at);
    const ch = channelOf(r.folder);
    if (day && (!first.has(ch) || day < first.get(ch)!)) first.set(ch, day);
  }
  for (const r of db().prepare("select folder, from_name, received_at from emails where received_at >= ? and received_at < ?").all(isoFrom(range), isoTo(range)) as { folder: string; from_name: string | null; received_at: string }[]) {
    const at = localDate(r.received_at);
    if (at) list.push({ at, day: at.toLocaleDateString("sv-SE"), mine: r.from_name === ME_SENDER, channel: channelOf(r.folder) });
  }
  // Teams: yours are the chat messages of the one sender who never wrote you a personal message or mentioned you.
  const own = db()
    .prepare("select sender_id s, count(*) n from teams_messages where kind = 'chat' and sender_id is not null and sender_id not in (select sender_id from teams_messages where kind <> 'chat' and sender_id is not null) group by sender_id order by n desc limit 1")
    .get() as { s: string } | undefined;
  const tFirst = (db().prepare("select min(sent_at) at from teams_messages").get() as { at: string | null }).at;
  if (tFirst) first.set("teams", localDay(tFirst)!);
  for (const r of db().prepare("select sender_id, sent_at from teams_messages where sent_at >= ? and sent_at < ?").all(isoFrom(range), isoTo(range)) as { sender_id: string | null; sent_at: string }[]) {
    const at = localDate(r.sent_at);
    if (at) list.push({ at, day: at.toLocaleDateString("sv-SE"), mine: !!own && r.sender_id === own.s, channel: "teams" });
  }
  return { list, first };
}

const CHANNELS = (): [string, string][] => [
  ["mail", t("Mail")],
  ["whatsapp", "WhatsApp"],
  ["signal", "Signal"],
  ["teams", "Teams"],
];

function messageSeries(range: SeriesRange, msgs: ReturnType<typeof messages>): Series[] {
  const out: Series[] = [];
  for (const [ch, name] of CHANNELS()) {
    const first = msgs.first.get(ch);
    if (!first) continue;
    const of = msgs.list.filter((m) => m.channel === ch);
    out.push({ id: `messages:${ch}:received`, label: t("{channel} received", { channel: name }), group: t("Messages"), kind: "number", values: filled(count(of.filter((m) => !m.mine)), range, first) });
    if (of.some((m) => m.mine) || ch !== "mail") out.push({ id: `messages:${ch}:sent`, label: t("{channel} sent", { channel: name }), group: t("Messages"), kind: "number", values: filled(count(of.filter((m) => m.mine)), range, first) });
  }
  return out;
}

function todoSeries(range: SeriesRange): Series[] {
  const first = (db().prepare("select min(created_at) at from todos").get() as { at: string | null }).at;
  if (!first) return [];
  const rows = db().prepare("select created_at, done_at from todos where (created_at >= ? and created_at < ?) or (done_at >= ? and done_at < ?)").all(isoFrom(range), isoTo(range), isoFrom(range), isoTo(range)) as { created_at: string; done_at: string | null }[];
  const start = localDay(first);
  return [
    { id: "todos:created", label: t("Todos created"), group: t("Todos"), kind: "number", values: filled(count(rows.map((r) => ({ day: localDay(r.created_at) }))), range, start) },
    { id: "todos:done", label: t("Todos done"), group: t("Todos"), kind: "number", values: filled(count(rows.filter((r) => r.done_at).map((r) => ({ day: localDay(r.done_at!) }))), range, start) },
  ];
}

function spending(range: SeriesRange): Series[] {
  if (!isInstalled("finances") || !hasTable("bank_transactions")) return [];
  const span = db().prepare("select min(date) a, max(date) b from bank_transactions").get() as { a: string | null; b: string | null };
  const rows = db().prepare("select date, -sum(amount) v from bank_transactions where amount < 0 and date between ? and ? group by date").all(range.from, range.to) as { date: string; v: number }[];
  // To the last booking read: the days after it aren't known yet (not 0).
  return [{ id: "finances:spending", label: t("Spending"), group: t("Finances"), kind: "number", unit: "€", values: filled(new Map(rows.map((r) => [r.date, r.v])), range, span.a, span.b) }];
}

/** The first and last moment of the day you did something: a message of yours (chats, Teams), booked time with its start (and end). */
function activity(range: SeriesRange, msgs: ReturnType<typeof messages>): Series[] {
  const first = new Map<string, number>();
  const last = new Map<string, number>();
  const mark = (day: string, h: number) => {
    if (day < range.from || day > range.to) return;
    first.set(day, Math.min(first.get(day) ?? 24, h));
    last.set(day, Math.max(last.get(day) ?? 0, h));
  };
  // Mails of yours carry only their day when older — chats and Teams their minute.
  for (const m of msgs.list) if (m.mine && m.channel !== "mail") mark(m.day, m.at.getHours() + m.at.getMinutes() / 60);
  if (isInstalled("zeiterfassung"))
    for (const r of db().prepare("select date, start, hours from time_entries where start is not null and date between ? and ?").all(range.from, range.to) as { date: string; start: string; hours: number }[]) {
      const s = Number(r.start.slice(0, 2)) + Number(r.start.slice(3, 5)) / 60;
      mark(r.date, s);
      mark(r.date, Math.min(24, s + r.hours));
    }
  const round = (m: Map<string, number>) => new Map([...m].sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => [d, Math.round(v * 100) / 100]));
  return [
    { id: "activity:first", label: t("First activity (hour)"), group: t("Activity"), kind: "number", unit: "h", values: round(first) },
    { id: "activity:last", label: t("Last activity (hour)"), group: t("Activity"), kind: "number", unit: "h", values: round(last) },
  ];
}

/** The signals without their values (the widget's choice of a target): those whose source is there. */
function signalCatalog(): SeriesInfo[] {
  const of = (id: string, label: string, group: string, unit?: string): SeriesInfo => ({ id, label, group, kind: "number", ...(unit ? { unit } : {}) });
  return [
    of("calendar:meeting-hours", t("Meeting hours"), t("Calendar"), "h"),
    ...(isInstalled("zeiterfassung") ? [of("time:booked-hours", t("Booked hours"), t("Time tracking"), "h")] : []),
    ...CHANNELS().flatMap(([ch, name]) => [of(`messages:${ch}:received`, t("{channel} received", { channel: name }), t("Messages")), of(`messages:${ch}:sent`, t("{channel} sent", { channel: name }), t("Messages"))]),
    of("todos:created", t("Todos created"), t("Todos")),
    of("todos:done", t("Todos done"), t("Todos")),
    ...(isInstalled("finances") ? [of("finances:spending", t("Spending"), t("Finances"), "€")] : []),
    of("activity:first", t("First activity (hour)"), t("Activity"), "h"),
    of("activity:last", t("Last activity (hour)"), t("Activity"), "h"),
  ];
}

export const SIGNAL_SERIES: SeriesProvider = {
  id: "correlations.signals",
  catalog: signalCatalog,
  series: (range) => {
    const msgs = messages(range);
    return [...meetingHours(range), ...bookedHours(range), ...messageSeries(range, msgs), ...todoSeries(range), ...spending(range), ...activity(range, msgs)];
  },
};
