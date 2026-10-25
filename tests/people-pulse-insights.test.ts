import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * The rhythm of a relationship (people/pulse-insights.ts): days in touch per channel over 12 months, the usual gap between them and
 * the drift (days since over the usual gap), who starts a conversation (after 8 hours of quiet), the median time to answer either way —
 * pure over a list of messages, read from the chats, mail threads, Teams and the appointments; the people drifting; and a day with
 * someone as a 0/1 series for the Correlations (personal).
 */

const NOW = new Date("2026-10-21T12:00:00Z");
const DAY = 864e5;
const ago = (days: number, hours = 0) => new Date(NOW.getTime() - days * DAY - hours * 36e5).toISOString();
const local = (iso: string) => new Date(iso).toLocaleDateString("sv-SE");

test("pure: days in touch per channel, the usual gap, the drift — drifting only with four days of history, twice the gap and a week", async () => {
  const { pulseInsight, contactDays, typicalGap, median } = await import("@/plugins/people/pulse-insights");
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
  // Every 7 days for four weeks (WhatsApp), one of them a mail too — the last 28 days ago.
  const msgs = [56, 49, 42, 35, 28].map((d) => ({ at: ago(d), channel: "WhatsApp" as const }));
  msgs.push({ at: ago(42, 1), channel: "Mail" as never });
  const { days, byChannel } = contactDays(msgs);
  assert.equal(days.length, 5, "a day on two channels is one day");
  assert.deepEqual(byChannel, { WhatsApp: 5, Mail: 1 });
  assert.equal(typicalGap(days), 7);
  const x = pulseInsight(msgs, NOW);
  assert.equal(x.typicalGap, 7);
  assert.equal(x.daysSince, 28);
  assert.equal(x.drift, 4);
  assert.equal(x.drifting, true);
  assert.equal(x.lastDay, local(ago(28)));
  // On rhythm: the last contact 7 days ago.
  assert.equal(pulseInsight([...msgs, { at: ago(21), channel: "WhatsApp" }, { at: ago(14), channel: "WhatsApp" }, { at: ago(7), channel: "WhatsApp" }], NOW).drifting, false);
  // Three days only: no rhythm to speak of.
  assert.equal(pulseInsight(msgs.slice(0, 3), NOW).drifting, false);
  // Daily, two quiet days: twice the gap, but under a week.
  const daily = [6, 5, 4, 3, 2].map((d) => ({ at: ago(d), channel: "Signal" as const }));
  const y = pulseInsight(daily, NOW);
  assert.equal(y.typicalGap, 1);
  assert.equal(y.drift, 2);
  assert.equal(y.drifting, false);
  // Messages after now don't count.
  assert.equal(pulseInsight([{ at: new Date(NOW.getTime() + DAY).toISOString(), channel: "WhatsApp" }], NOW).contactDays, 0);
});

test("pure: who starts — the first message after 8 hours of quiet in that chat; how fast each answers — from the first of the other's run, a week at most", async () => {
  const { initiative, replyTimes } = await import("@/plugins/people/pulse-insights");
  const m = (days: number, hours: number, mine: boolean, conv = "wa:Ana") => ({ at: ago(days, hours), channel: "WhatsApp" as const, mine, conv });
  const msgs = [
    // Day 10: they start; you answer 30 min after their first (they wrote twice), they answer 10 min later.
    m(10, 3, false),
    m(10, 2.75, false),
    m(10, 2.5, true),
    m(10, 2 + 20 / 60, false),
    // Day 5: you start (8 h and more later); they answer after 2 h.
    m(5, 4, true),
    m(5, 2, false),
    // Day 2: you start again — 3 hours later still the same conversation.
    m(2, 6, true),
    m(2, 3, true),
    // Another chat (a mail thread): they start; you answer after 9 days — no answer, a new start.
    { at: ago(20), channel: "Mail" as const, mine: false, conv: "c1" },
    { at: ago(11), channel: "Mail" as const, mine: true, conv: "c1" },
    // An appointment: a day in touch, nothing more.
    { at: ago(1), channel: "Appointment" as const },
  ];
  assert.deepEqual(initiative(msgs), { mine: 3, theirs: 2, share: 0.6 });
  // Yours: 30 min; theirs: 10 min and 120 min → median 65.
  assert.deepEqual(replyTimes(msgs), { mine: 30, theirs: 65 });
  assert.deepEqual(replyTimes([]), { mine: null, theirs: null });
  assert.deepEqual(initiative([]), { mine: 0, theirs: 0, share: null });
});

async function seed() {
  const { getDb, schema } = await import("@/db");
  const { createPerson, listPeople } = await import("@/plugins/people/store");
  const had = listPeople().find((p) => p.name === "Ana Rhythm");
  if (had) return Object.fromEntries(listPeople().map((p) => [p.name.split(" ")[0].toLowerCase(), p.id])) as Record<string, number>;
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["people", "calendar", "correlations", "teams"]) setInstalled(p, true);
  const db = getDb();
  let n = 0;
  const mail = (conv: string, folder: string, fromName: string, fromEmail: string | null, at: string, extra: Record<string, unknown> = {}) =>
    db.insert(schema.emails).values({ key: `k${++n}`, convId: conv, syncedAt: ago(0), folder, fromName, fromEmail, subject: "Hallo", preview: "…", receivedAt: at, ...extra } as never).run();
  const ana = createPerson({ name: "Ana Rhythm", whatsapp: "Ana" });
  const bo = createPerson({ name: "Bo Mailer", emails: ["bo@example.org"] });
  const cy = createPerson({ name: "Cy Teams" });
  const dee = createPerson({ name: "Dee Kaffee" });
  createPerson({ name: "Nie Gehört" });
  // Ana: WhatsApp every 7 days (she starts, you answer in 15 minutes), the last 35 days ago — drifting; a group named like her doesn't count.
  for (const d of [63, 56, 49, 42, 35]) {
    mail("wa:Ana", "WhatsApp", "Ana", null, ago(d, 2));
    mail("wa:Ana", "WhatsApp", "Ich", null, ago(d, 1.75));
  }
  mail("wa:Ana Rhythm", "WhatsApp", "Ana", null, ago(1), { isGroup: true });
  // Bo: a mail thread — he writes, you answer a day later from the sent folder, someone else in copy writes too.
  mail("c-bo", "Posteingang", "Bo Mailer", "Bo@Example.org", ago(30));
  mail("c-bo", "Gmail · Sent", "Moritz Roessler", "me@example.org", ago(29));
  mail("c-bo", "Posteingang", "Someone Else", "else@example.org", ago(28));
  // Cy: Teams — a chat of the two of you (you answer), and a group where only Cy counts.
  const own = "me-id";
  // (You: a chat sender who never wrote you a personal message.)
  const tm = (key: string, conv: string, kind: string, sender: string, senderId: string, at: string) =>
    db.insert(schema.teamsMessages).values({ key, kind, conversationId: conv, messageId: key, sentAt: at, html: "", text: "…", link: "l", syncedAt: ago(0), senderName: sender, senderId, place: conv } as never).run();
  tm("t1", "chat-cy", "pm", "Cy Teams", "cy-id", ago(4, 5));
  tm("t2", "chat-cy", "chat", "Moritz Roessler", own, ago(4, 4));
  tm("t3", "group", "chat", "Cy Teams", "cy-id", ago(3));
  tm("t4", "group", "chat", "Zed Other", "zed-id", ago(3, -1));
  tm("t5", "group", "chat", "Moritz Roessler", own, ago(3, -2));
  // Dee: an appointment that's over, one to come.
  const { createCalendar, addEvent } = await import("@/lib/calendar/ir");
  const cal = createCalendar("Privat");
  const on = (iso: string) => {
    const d = new Date(iso);
    const p = (x: number) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  addEvent(cal.id, { title: "Kaffee", start: on(ago(10)), end: on(ago(10, -1)), attendees: ["Dee Kaffee"] });
  addEvent(cal.id, { title: "Kaffee", start: on(ago(-2)), end: on(ago(-2, -1)), attendees: ["Dee Kaffee"] });
  return { ana, bo, cy, dee };
}

test("reader: a person's chat (not a group named like them), their mail threads (yours by the sent folder), Teams (yours in a chat of the two of you), appointments that are over", async () => {
  const ids = await seed();
  const { pulseMessages, personPulse, eventsIn } = await import("@/plugins/people/pulse-insights");
  const { getPerson } = await import("@/plugins/people/store");
  const from = ago(365);
  const to = NOW.toISOString();
  const ana = pulseMessages(getPerson(ids.ana)!, from, to);
  assert.equal(ana.length, 10, "the group is left out");
  assert.ok(ana.every((m) => m.channel === "WhatsApp" && m.conv === "wa:Ana"));
  const a = await personPulse(getPerson(ids.ana)!, NOW);
  assert.equal(a.contactDays, 5);
  assert.equal(a.typicalGap, 7);
  assert.equal(a.daysSince, 35);
  assert.equal(a.drifting, true);
  assert.deepEqual(a.initiative, { mine: 0, theirs: 5, share: 0 });
  assert.deepEqual(a.reply, { mine: 15, theirs: null });

  const bo = pulseMessages(getPerson(ids.bo)!, from, to);
  assert.deepEqual(bo.map((m) => [m.mine, m.conv]), [[false, "c-bo"], [true, "c-bo"], [undefined, undefined]], "his (the address in any case), yours (sent), someone else's: a day only");
  const b = await personPulse(getPerson(ids.bo)!, NOW);
  assert.deepEqual(b.byChannel, { Mail: 3 });
  assert.deepEqual(b.reply, { mine: 1440, theirs: null });

  const c = await personPulse(getPerson(ids.cy)!, NOW);
  assert.deepEqual(c.byChannel, { Teams: 2 });
  assert.deepEqual(c.initiative, { mine: 0, theirs: 1, share: 0 }, "the group isn't a conversation of the two of you");
  assert.deepEqual(c.reply, { mine: 60, theirs: null });

  const events = await eventsIn(new Date(from), NOW);
  const dee = pulseMessages(getPerson(ids.dee)!, from, to, events);
  assert.deepEqual(dee.map((m) => m.channel), ["Appointment"], "the one over, not the coming one");
});

test("drifting: the people well beyond their rhythm, the furthest first; a day with them as a 0/1 series from their first contact on — personal", async () => {
  const ids = await seed();
  const { driftingPeople, contactDaysByPerson, PEOPLE_SERIES } = await import("@/plugins/people/pulse-insights");
  const drifting = await driftingPeople(NOW);
  assert.deepEqual(drifting.map((d) => [d.personId, d.typicalGap, d.daysSince]), [[ids.ana, 7, 35]]);

  const range = { from: local(ago(70)), to: local(ago(1)) };
  const top = await contactDaysByPerson(range, 2);
  assert.deepEqual(top.map((x) => x.person.id), [ids.ana, ids.bo], "the most days in the period first, only so many");

  const series = await PEOPLE_SERIES.series(range);
  const ana = series.find((s) => s.id === `people:${ids.ana}:contact`)!;
  assert.equal(ana.label, "Contact with Ana Rhythm");
  assert.equal(ana.group, "People");
  assert.equal(ana.kind, "binary");
  const first = local(ago(63, 2));
  assert.equal([...ana.values.keys()][0], first, "from her first contact on");
  assert.equal(ana.values.get(first), 1);
  assert.equal(ana.values.get(local(ago(60))), 0);
  assert.equal(ana.values.get(local(ago(1))), 0);
  assert.ok(!series.some((s) => s.id.includes(":contact") && s.label.includes("Nie")), "never heard of: no series");

  // Through the Correlations: there for you, not for an agent without clearance for personal data.
  await import("@/plugins/contributions");
  const { allSeries } = await import("@/plugins/correlations/series");
  const { visibleSeries } = await import("@/plugins/correlations/boundaries");
  const all = await allSeries(range);
  assert.ok(all.some((s) => s.id === ana.id));
  assert.ok(visibleSeries(all, "personal").some((s) => s.id === ana.id));
  assert.ok(!visibleSeries(all, "open").some((s) => s.id.startsWith("people:")), "personal: not for an agent without clearance");
});

test("the person's page and the widget: the rhythm in words; the drifting with “usually every N days, now M days”", async () => {
  const ids = await seed();
  const { personPageData } = await import("@/plugins/people/row-data");
  const { personPulse } = await import("@/plugins/people/pulse-insights");
  const { getPerson } = await import("@/plugins/people/store");
  const { translator } = await import("@/lib/i18n/shared");
  const pulse = await personPulse(getPerson(ids.ana)!, NOW);
  const data = personPageData({ person: { id: ids.ana, name: "Ana Rhythm", aliases: [], emails: [], jira: [], whatsapp: "Ana", note: "", starred: false, compiled: null, details: [], claims: [], others: [], dates: [], links: [], relations: { out: [], in: [] }, contacts: [], todos: [], cases: [], documents: [], pages: [], tickets: [], events: null, pulse } as never, error: null, loading: false, wiki: null }, { t: translator("en") });
  const p = data.pulse as Record<string, unknown>;
  assert.equal(p.any, true);
  assert.equal(p.days, "5 days in touch in the last 12 months");
  assert.equal(p.channels, "WhatsApp 5");
  assert.equal(p.rhythm, "Usually every 7 days — the last contact 35 days ago");
  assert.equal(p.drift, "Drifting: 5× the usual gap");
  assert.equal(p.initiative, "You start 0% of your conversations (0 of 5)");
  assert.equal(p.reply, "you answer in 15 min");

  const { PEOPLE_WIDGETS } = await import("@/plugins/people/widgets");
  const w = PEOPLE_WIDGETS.find((x) => x.id === "people.drifting")!;
  // (The widget counts to today, not to NOW: Ana drifts further still.)
  const out = (await w.data({ limit: 6 })) as { kind: string; items: { text: string; detail?: string }[] };
  assert.equal(out.items[0]?.text, "Ana Rhythm");
  assert.match(out.items[0]?.detail ?? "", /^usually every 7 days, now \d+ days$/);
});
