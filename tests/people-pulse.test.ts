import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const NOW = new Date("2026-10-21T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 864e5).toISOString();

async function seed() {
  const { getDb, schema } = await import("@/db");
  const { createPerson, listPeople } = await import("@/plugins/people/store");
  const had = listPeople().find((p) => p.name === "Karla Weiss");
  if (had) return Object.fromEntries(listPeople().map((p) => [p.name.split(" ")[0].toLowerCase(), p.id])) as Record<string, number>;
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["people", "todos", "calendar"]) setInstalled(p, true);
  const db = getDb();
  const mail = (key: string, conv: string, folder: string, fromName: string, fromEmail: string | null, days: number, preview = "…") =>
    db.insert(schema.emails).values({ key, convId: conv, syncedAt: ago(0), folder, fromName, fromEmail, subject: "Hallo", preview, receivedAt: ago(days) } as never).run();
  const karla = createPerson({ name: "Karla Weiss", whatsapp: "Karla" });
  const ulla = createPerson({ name: "Ulla Nathanael", emails: ["ogv.nathanael@gvjustiz.de"] });
  const rico = createPerson({ name: "Rico Clemen" });
  const hans = createPerson({ name: "Hans Kruger" });
  const nobody = createPerson({ name: "Nie Gehört" });
  // Karla: her chat, the last message mine (10 days ago).
  mail("w1", "wa:Karla", "WhatsApp", "Karla", null, 20, "Wie geht's?");
  mail("w2", "wa:Karla", "WhatsApp", "Ich", null, 10, "Gut, und dir?");
  // Ulla: her mail 40 days ago, my answer in the thread 30 days ago.
  mail("m1", "c-ulla", "Gmail · Archive", "Ulla Nathanael", "OGV.Nathanael@gvjustiz.de", 40, "Ratenplan");
  mail("m2", "c-ulla", "Gmail · Sent", "Moritz Roessler", "moritz@example.org", 30, "Danke, passt");
  // Rico: Teams, 5 days ago.
  db.insert(schema.teamsMessages).values({ key: "t1", kind: "chat", conversationId: "x", messageId: "1", sentAt: ago(5), html: "", text: "Kurze Frage", link: "l", syncedAt: ago(0), senderName: "Rico Clemen", place: "PROJ Devs" } as never).run();
  // Hans: a meeting 3 days ago — and one tomorrow.
  const { createCalendar, addEvent } = await import("@/lib/calendar/ir");
  const cal = createCalendar("Privat");
  addEvent(cal.id, { title: "Kaffee", start: "2026-10-18T10:00", end: "2026-10-18T11:00", attendees: ["Hans Kruger"] });
  addEvent(cal.id, { title: "Projekt-Update mit Hans", start: "2026-10-22T09:00", end: "2026-10-22T09:30", attendees: ["Hans Kruger <hans@example.org>"] });
  return { karla, ulla, rico, hans, nie: nobody };
}

test("pulse: the last contact with each person — their chat either way, a mail thread with them (your answer too), Teams, an appointment that's over", async () => {
  const ids = await seed();
  const { lastContactsAll } = await import("@/plugins/people/pulse");
  const { listPeople } = await import("@/plugins/people/store");
  const last = await lastContactsAll(listPeople(), NOW);
  assert.deepEqual(last.get(ids.karla), { at: ago(10), channel: "WhatsApp" }, "your message counts");
  assert.deepEqual(last.get(ids.ulla), { at: ago(30), channel: "Mail" }, "your answer in her thread, the address in any case");
  assert.deepEqual(last.get(ids.rico), { at: ago(5), channel: "Teams" });
  assert.equal(last.get(ids.hans)?.channel, "Appointment");
  assert.equal(last.get(ids.hans)?.at.slice(0, 10), "2026-10-18", "the one over, not tomorrow's");
  assert.equal(last.get(ids.nie), undefined);
});

test("pulse: who to get in touch with — the starred, family and friends you haven't heard of for weeks; not work, not someone never heard of; a snooze waits", async () => {
  const ids = await seed();
  const { updatePerson, setCircle } = await import("@/plugins/people/store");
  const { nudges, snoozeNudge } = await import("@/plugins/people/pulse");
  updatePerson(ids.ulla, { starred: true });
  setCircle(ids.karla, "friends", "manual");
  setCircle(ids.rico, "work", "manual");
  setCircle(ids.nie, "family", "manual");
  // Ulla: 30 days without contact, starred → yes (4 weeks); Karla: 10 days → not yet; Rico: work → never; Nie: no contact known → not.
  assert.deepEqual(nudges({ now: NOW, weeks: 4 }).map((n) => [n.personId, n.days]), [[ids.ulla, 30]]);
  assert.deepEqual(nudges({ now: NOW, weeks: 1 }).map((n) => n.personId).sort(), [ids.karla, ids.ulla].sort(), "a shorter rhythm finds Karla too");
  snoozeNudge(ids.ulla, 14, NOW);
  assert.deepEqual(nudges({ now: NOW, weeks: 4 }), [], "snoozed for two weeks");
  assert.equal(nudges({ now: new Date(NOW.getTime() + 15 * 864e5), weeks: 4 })[0]?.personId, ids.ulla, "and back after them");
});

test("circles by rule: a relation (mother, sister …) or your last name is family; a case or an authority's address is authorities & creditors; a Jira account or Teams is work — yours and the AI's stay", async () => {
  const ids = await seed();
  const { createPerson, getPerson, addRelation, addAccount, setCircle } = await import("@/plugins/people/store");
  const { applyCircleRules, ruleCircle } = await import("@/plugins/people/pulse");
  const mum = createPerson({ name: "Johanna Roessler" });
  const lotte = createPerson({ name: "Lotte" });
  addRelation(lotte, "meine Schwester", 0, "", "manual");
  const dev = createPerson({ name: "Christopher Kruger" });
  addAccount(dev, "jira", "ckruger");
  const n = applyCircleRules();
  assert.ok(n >= 4);
  assert.equal(getPerson(mum)!.circle, "family", "your last name (from the mails you sent)");
  assert.equal(getPerson(lotte)!.circle, "family", "a relation");
  assert.equal(getPerson(ids.ulla)!.circle, "authorities", "gvjustiz.de");
  assert.equal(getPerson(dev)!.circle, "work", "a Jira account");
  assert.equal(getPerson(ids.rico)!.circle, "work", "Teams");
  const benni = createPerson({ name: "Benni" });
  applyCircleRules();
  assert.equal(getPerson(benni)!.circleSource, "", "nothing to go by: left to the AI");
  setCircle(dev, "friends", "manual");
  applyCircleRules();
  assert.equal(getPerson(dev)!.circle, "friends", "yours stays");
  setCircle(benni, "friends", "ai");
  assert.equal(setCircle(benni, "work", "rule"), false, "a rule doesn't undo the AI");
  assert.equal(getPerson(benni)!.circle, "friends");
  assert.equal(ruleCircle(getPerson(ids.nie)!, { me: ["moritz roessler"] }), "");
});

test("accept the confident ones: claims and links from 90 % on are confirmed at once — the rest, and every identity suggestion, wait", async () => {
  const ids = await seed();
  const { addClaim, addLink, claimsOf, proposedLinks } = await import("@/plugins/people/graph");
  const { acceptConfident } = await import("@/plugins/people/pulse");
  addClaim({ personId: ids.hans, kind: "role", text: "Projektleiter", confidence: 0.95 });
  addClaim({ personId: ids.hans, kind: "fact", text: "Mag Kaffee", confidence: 0.85 });
  addLink({ personId: ids.hans, rel: "works-with", targetType: "person", targetRef: String(ids.rico), confidence: 0.92 });
  const r = acceptConfident(0.9);
  assert.deepEqual(r, { claims: 1, links: 1 });
  const status = Object.fromEntries(claimsOf(ids.hans).map((c) => [c.text, c.status]));
  assert.equal(status["Projektleiter"], "confirmed");
  assert.equal(status["Mag Kaffee"], "proposed");
  assert.equal(proposedLinks().filter((l) => l.personId === ids.hans).length, 0);
});

test("compile what's out of date: never compiled, or something new about them since (a claim, a contact)", async () => {
  const ids = await seed();
  const { setCompiled } = await import("@/plugins/people/store");
  const { addClaim } = await import("@/plugins/people/graph");
  const { staleForCompile } = await import("@/plugins/people/pulse");
  const summary = (at: string) => ({ connection: "x", keyFacts: [], funFacts: [], at, sources: 1 });
  setCompiled(ids.karla, summary(ago(15))); // her chat came after (10 days ago)
  setCompiled(ids.rico, summary(ago(1))); // nothing since
  setCompiled(ids.hans, summary(ago(1)));
  addClaim({ personId: ids.hans, kind: "fact", text: "Neu: zieht um", confidence: 0.9 }); // a claim since
  const stale = staleForCompile(NOW);
  assert.ok(stale.includes(ids.karla), "a contact since");
  assert.ok(stale.includes(ids.hans), "a claim since");
  assert.ok(stale.includes(ids.ulla), "never compiled, something known");
  assert.ok(!stale.includes(ids.rico));
  assert.ok(!stale.includes(ids.nie), "nothing known: nothing to compile");
});

test("meeting briefs: an appointment with someone in the next 24 hours — what came since you last met, what is open between you, the cases with them", async () => {
  const ids = await seed();
  const { addClaim } = await import("@/plugins/people/graph");
  addClaim({ personId: ids.hans, kind: "commitment", text: "Schickt die Folien", direction: "theirs", confidence: 0.9 });
  const { meetingBriefs } = await import("@/plugins/people/pulse");
  const briefs = await meetingBriefs(NOW);
  assert.equal(briefs.length, 1);
  const b = briefs[0];
  assert.equal(b.personId, ids.hans);
  assert.equal(b.title, "Projekt-Update mit Hans");
  assert.equal(b.lastMet?.slice(0, 10), "2026-10-18");
  assert.deepEqual(b.owed.map((o) => o.text), ["Schickt die Folien"]);
});

test("people overview: each card's last contact, circle and what is open; a circle you pick stays; a todo for someone names them", async () => {
  const ids = await seed();
  const { peopleOverview, peopleTool } = await import("@/plugins/people/tools");
  await peopleTool({ tool: "circle", id: ids.hans, circle: "work" });
  const o = await peopleOverview();
  assert.equal(o.cards[ids.ulla].lastContact?.channel, "Mail");
  assert.equal(o.cards[ids.ulla].email, "ogv.nathanael@gvjustiz.de");
  assert.equal(o.cards[ids.hans].circle, "work");
  assert.equal(o.cards[ids.hans].circleSource, "manual");
  assert.ok(o.cards[ids.hans].owed.some((x) => x.text === "Schickt die Folien" && x.direction === "theirs"));
  await peopleTool({ tool: "todo", id: ids.hans, text: "Folien nachfragen" });
  const { listTodos } = await import("@/lib/boards/store");
  assert.ok(listTodos({ status: "open" }).some((x) => x.text === "Folien nachfragen (Hans Kruger)"));
  await peopleTool({ tool: "settings", weeks: 3, myName: "Moritz Roessler" });
  assert.equal((await peopleOverview()).settings.weeks, 3);
});
