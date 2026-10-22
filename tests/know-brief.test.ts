import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** "Now" for the whole file: Thursday 22 October 2026, 10:00 local time. */
const NOW = new Date(2026, 9, 22, 10, 0, 0);
const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => iso(new Date(NOW.getTime() - n * 864e5));
const pad = (n: number) => String(n).padStart(2, "0");
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

async function install(...ids: string[]) {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ids) setInstalled(id, true);
}

/** Anna: a role, a fact that holds and one superseded, a birthday in five days, two open loops (one overdue), mails and a chat. */
async function anna(): Promise<number> {
  await install("people", "timeline", "know");
  const { createPerson, addDate } = await import("@/plugins/people/store");
  const { addClaim } = await import("@/plugins/people/graph");
  const { recordFact } = await import("@/lib/trust/store");
  const { recordEvent } = await import("@/plugins/timeline/store");
  const id = createPerson({ name: "Anna Weber", emails: ["anna.weber@example.com"] });
  addClaim({ personId: id, kind: "role", text: "Projektleiterin PROJ", status: "confirmed", sourceRef: "mail:m1" });
  addClaim({ personId: id, kind: "commitment", text: "schickt mir das Angebot", direction: "theirs", due: "2026-10-20", status: "confirmed", sourceRef: "mail:m1" });
  addClaim({ personId: id, kind: "commitment", text: "ich schicke ihr die Zahlen", direction: "mine", due: "2026-10-30", confidence: 0.9, sourceRef: "teams:t1" });
  // Done: not an open loop any more.
  addClaim({ personId: id, kind: "commitment", text: "Rückruf", direction: "theirs", status: "confirmed", sourceRef: "mail:m0" });
  const { getSqlite } = await import("@/db");
  getSqlite().prepare("update people_claims set done_at = ? where text = 'Rückruf'").run(daysAgo(1));
  recordFact({ subject: `person:${id}`, subjectLabel: "Anna Weber", attribute: "address", value: "Alte Straße 1, 50667 Köln", writer: "details", sourceRef: "mail:m0" });
  recordFact({ subject: `person:${id}`, subjectLabel: "Anna Weber", attribute: "address", value: "Neue Straße 9, 50667 Köln", writer: "details", sourceRef: "you", byUser: true });
  const birthday = new Date(NOW.getTime() + 5 * 864e5);
  addDate(id, { kind: "birthday", day: birthday.getDate(), month: birthday.getMonth() + 1, year: 1990, confirmed: true });
  recordEvent({ at: daysAgo(2), kind: "mail", source: "mail", sourceRef: "m1", title: "Angebot PROJ-12", summary: "Anbei die Zahlen", url: "/mail?q=Angebot", refs: ["mail:m1", `person:${id}`, "ticket:PROJ-12"] });
  recordEvent({ at: daysAgo(1), kind: "message", source: "whatsapp", sourceRef: "wa:1", title: "Anna Weber", summary: "Bis morgen!", refs: ["msg:whatsapp:wa:1", `person:${id}`] });
  recordEvent({ at: daysAgo(40), kind: "comment", source: "jira", sourceRef: "comment:9", title: "PROJ-12 · Anna", summary: "Bitte prüfen", refs: ["ticket:PROJ-12", `person:${id}`] });
  return id;
}

let annaId = 0;
const getAnna = async () => (annaId ||= await anna());

test("a person's brief: who they are (only what holds), the last interactions, open loops, related tickets, a birthday near", async () => {
  const id = await getAnna();
  const { briefFor } = await import("@/plugins/know/brief");
  const b = await briefFor([`person:${id}`], { now: NOW, health: [] });
  assert.equal(b.people.length, 1);
  const p = b.people[0];
  assert.equal(p.name, "Anna Weber");
  assert.equal(p.role, "Projektleiterin PROJ");
  assert.ok(p.facts.some((f) => f.text.includes("Neue Straße 9")), "the address that holds");
  assert.ok(!p.facts.some((f) => f.text.includes("Alte Straße 1")), "a superseded one never");
  assert.equal(p.birthday?.inDays, 5);
  assert.equal(p.lastContact?.kind, "message", "the newest interaction");
  // Open loops: theirs overdue, mine open; the done one gone.
  assert.deepEqual(b.loops.map((l) => [l.direction, l.text, l.overdue]), [
    ["mine", "ich schicke ihr die Zahlen", false],
    ["theirs", "schickt mir das Angebot", true],
  ]);
  assert.deepEqual(b.recent.map((e) => e.kind), ["message", "mail", "comment"]);
  assert.ok(b.related.some((r) => r.ref === "ticket:PROJ-12"), "the ticket their mails are about");
  assert.match(b.hash, /^[0-9a-f]{40}$/);
});

test("boundaries: personal data only for a personal clearance; secret never — and the brief says how much was left out", async () => {
  const id = await getAnna();
  const { briefFor } = await import("@/plugins/know/brief");
  const { withClearance, setSourceLabel } = await import("@/lib/boundaries");
  const mine = await briefFor([`person:${id}`], { now: NOW, health: [] });
  assert.ok(mine.recent.some((e) => e.source === "whatsapp"), "you see your WhatsApp");
  const agent = await withClearance("open", () => briefFor([`person:${id}`], { now: NOW, health: [] }));
  assert.ok(!agent.recent.some((e) => e.source === "whatsapp"), "an agent without personal clearance doesn't");
  assert.ok(agent.hidden >= 1);
  setSourceLabel("mail", "secret");
  try {
    const b = await briefFor([`person:${id}`], { now: NOW, health: [] });
    assert.ok(!b.recent.some((e) => e.source === "mail"), "a secret source's events never");
    assert.ok(!b.loops.some((l) => l.text === "schickt mir das Angebot"), "nor what was read in it");
    assert.ok(!b.people[0].role, "nor the role read from that mail");
    assert.ok(b.hidden >= 3);
  } finally {
    setSourceLabel("mail", null);
  }
});

test("stale sources: the ones the brief relies on that aren't well are named", async () => {
  const id = await getAnna();
  const { briefFor, staleSources } = await import("@/plugins/know/brief");
  const health = [
    { key: "mail", label: "Mail", href: "/mail", state: "stale", reason: "no run for 3 hours" },
    { key: "whatsapp", label: "WhatsApp", href: "/apps/whatsapp", state: "ok", reason: "" },
    { key: "news", label: "News", href: "/news", state: "silent", reason: "nothing new" },
  ];
  assert.deepEqual(staleSources(["mail", "whatsapp"], health).map((h) => h.key), ["mail"]);
  const b = await briefFor([`person:${id}`], { now: NOW, health });
  assert.deepEqual(b.stale.map((s) => s.key), ["mail"], "news isn't something it relies on");
});

test("a meeting's brief: its people from the attendees, the ticket in its title, the meeting itself", async () => {
  const id = await getAnna();
  await install("calendar");
  const { addEvent, zeffCalendar } = await import("@/lib/calendar/ir");
  const start = new Date(NOW.getTime() + 20 * 60e3);
  const end = new Date(NOW.getTime() + 80 * 60e3);
  const e = addEvent(zeffCalendar().id, { title: "Abstimmung PROJ-12", start: local(start), end: local(end), attendees: ["Anna Weber <anna.weber@example.com>", "jemand@else.de"], organizer: "ich@example.com" });
  const { meetingBrief, upcomingMeetings } = await import("@/plugins/know/brief");
  const b = await meetingBrief(e.id, { now: NOW, health: [] });
  assert.ok(b);
  assert.equal(b!.meeting?.title, "Abstimmung PROJ-12");
  assert.deepEqual(b!.people.map((p) => p.id), [id]);
  assert.ok(b!.related.some((r) => r.ref === "ticket:PROJ-12"));
  assert.ok(b!.loops.length >= 1, "the open loops with Anna");
  // Upcoming: within the next 30 minutes, with someone known in it.
  assert.deepEqual(upcomingMeetings({ now: NOW, withinMinutes: 30 }).map((m) => m.id), [e.id]);
  assert.deepEqual(upcomingMeetings({ now: NOW, withinMinutes: 10 }).map((m) => m.id), []);
  // A meeting with nobody known: no brief to speak of.
  const alone = addEvent(zeffCalendar().id, { title: "Fokuszeit", start: local(start), end: local(end) });
  assert.ok(!upcomingMeetings({ now: NOW, withinMinutes: 30 }).some((m) => m.id === alone.id));
});

test("a row's refs: a mail row is its mail, the people and tickets the timeline found in it, and the row", async () => {
  const id = await getAnna();
  await install("workspace");
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const dbId = w.createPage({ kind: "database", title: "Inbox", schema: { titleName: "Subject", properties: [{ id: "srcref", name: "Source", type: "text" }], views: [m.newView("Table")] } });
  const row = w.addRow(dbId, { title: "Angebot PROJ-12", cells: { srcref: "mail:m1" } });
  const { rowRefs } = await import("@/plugins/know/brief");
  const refs = rowRefs(row);
  assert.ok(refs.includes(`page:${row}`));
  assert.ok(refs.includes("mail:m1"));
  assert.ok(refs.includes(`person:${id}`));
  assert.ok(refs.includes("ticket:PROJ-12"));
});

test("as text for an agent: people, loops, the latest, related, with refs and links", async () => {
  const id = await getAnna();
  const { briefFor, briefText } = await import("@/plugins/know/brief");
  const text = briefText(await briefFor([`person:${id}`], { now: NOW, health: [] }));
  assert.match(text, /Anna Weber \[person:\d+\]/);
  assert.match(text, /Projektleiterin PROJ/);
  assert.match(text, /owed to you.*schickt mir das Angebot.*overdue/i);
  assert.match(text, /ticket:PROJ-12/);
});

test("an appointment's row (the calendar database) is briefed as its meeting", async () => {
  const id = await getAnna();
  await install("calendar", "workspace");
  const { addEvent, zeffCalendar } = await import("@/lib/calendar/ir");
  const start = new Date(NOW.getTime() + 3 * 3600e3);
  const e = addEvent(zeffCalendar().id, { title: "Jour fixe", start: local(start), end: local(new Date(start.getTime() + 1800e3)), attendees: ["anna.weber@example.com"] });
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const dbId = w.createPage({ kind: "database", title: "Termine", schema: { titleName: "Title", properties: [{ id: "srcref", name: "Source", type: "text" }], views: [m.newView("Table")] } });
  const row = w.addRow(dbId, { title: "Jour fixe", cells: { srcref: `event:${e.id}` } });
  const { briefOfKey } = await import("@/plugins/know/summary");
  const got = await briefOfKey({ row }, NOW);
  assert.equal(got?.key, `event:${e.id}`);
  assert.equal(got?.brief.meeting?.title, "Jour fixe");
  assert.deepEqual(got?.brief.people.map((p) => p.id), [id]);
});

test("a ticket's brief: the people its events concern most, and what is open with them", async () => {
  const id = await getAnna();
  const { briefFor } = await import("@/plugins/know/brief");
  const b = await briefFor(["ticket:PROJ-12"], { now: NOW, health: [] });
  assert.deepEqual(b.people.map((p) => p.id), [id], "Anna wrote about it");
  assert.ok(b.loops.some((l) => l.personId === id));
  assert.ok(!b.related.some((r) => r.ref === "ticket:PROJ-12"), "not related to itself");
});
