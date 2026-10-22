import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const NOW = new Date(2026, 9, 22, 10, 0, 0);
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 864e5).toISOString();
const pad = (n: number) => String(n).padStart(2, "0");
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

async function setup(): Promise<number> {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["people", "timeline", "know", "calendar"]) setInstalled(id, true);
  const { createPerson } = await import("@/plugins/people/store");
  const { addClaim } = await import("@/plugins/people/graph");
  const { recordEvent } = await import("@/plugins/timeline/store");
  const id = createPerson({ name: "Jonas Teich", emails: ["jonas@example.com"] });
  addClaim({ personId: id, kind: "commitment", text: "ich schicke ihm das Konzept", direction: "mine", due: "2026-10-21", status: "confirmed", sourceRef: "mail:k1" });
  recordEvent({ at: daysAgo(1), kind: "mail", source: "mail", sourceRef: "k1", title: "Konzept PROJ-7", summary: "Wann kommt das Konzept?", url: "/mail?q=Konzept", refs: ["mail:k1", `person:${id}`, "ticket:PROJ-7"] });
  return id;
}

let pid = 0;
const person = async () => (pid ||= await setup());

/** A fake AI: answers what it is given, counts its calls, keeps the last prompt. */
function fakeAi(answer: unknown) {
  const calls: string[] = [];
  const ai = async (prompt: string) => {
    calls.push(prompt);
    return answer as never;
  };
  return { ai, calls };
}

test("the AI's input: numbered lines with what the brief says; the answer kept only with valid sources, linked", async () => {
  const id = await person();
  const { briefFor } = await import("@/plugins/know/brief");
  const { summaryLines, summarizeBrief } = await import("@/plugins/know/summary");
  const b = await briefFor([`person:${id}`], { now: NOW, health: [] });
  const lines = summaryLines(b);
  assert.ok(lines.some((l) => /Jonas Teich/.test(l.text)));
  assert.ok(lines.some((l) => /ich schicke ihm das Konzept/.test(l.text) && /überfällig/.test(l.text)));
  const { ai, calls } = fakeAi({ points: [{ text: "Du schuldest Jonas das Konzept (überfällig).", sources: [2, 99] }, { text: "Erfunden", sources: [] }, { text: "Unsinn", sources: [77] }] });
  const s = await summarizeBrief(`person:${id}`, b, { ai });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /Du bereitest mich/);
  assert.match(calls[0], /\[2\] /);
  assert.deepEqual(s?.points.map((p) => p.text), ["Du schuldest Jonas das Konzept (überfällig)."], "a point without a valid source is dropped");
  assert.equal(s?.points[0].sources.length, 1);
  assert.equal(s?.current, true);
});

test("cached per brief: the same inputs never ask the AI again; changed inputs say the summary is old until made again", async () => {
  const id = await person();
  const { briefFor } = await import("@/plugins/know/brief");
  const { summarizeBrief, cachedSummary } = await import("@/plugins/know/summary");
  const key = `test:${id}`;
  const b = await briefFor([`person:${id}`], { now: NOW, health: [] });
  const { ai, calls } = fakeAi({ points: [{ text: "Punkt", sources: [1] }] });
  await summarizeBrief(key, b, { ai });
  await summarizeBrief(key, b, { ai });
  assert.equal(calls.length, 1, "nothing changed: no AI call");
  const { recordEvent } = await import("@/plugins/timeline/store");
  recordEvent({ at: daysAgo(0.5), kind: "mail", source: "mail", sourceRef: "k2", title: "Neue Mail", refs: ["mail:k2", `person:${id}`] });
  const b2 = await briefFor([`person:${id}`], { now: NOW, health: [] });
  assert.notEqual(b2.hash, b.hash);
  assert.equal(cachedSummary(key, b2.hash)?.current, false, "kept, but marked old");
  await summarizeBrief(key, b2, { ai });
  assert.equal(calls.length, 2);
  assert.equal(cachedSummary(key, b2.hash)?.current, true);
  // An empty brief costs nothing.
  const empty = await briefFor(["ticket:NONE-1"], { now: NOW, health: [] });
  assert.equal(await summarizeBrief("empty", empty, { ai }), null);
  assert.equal(calls.length, 2);
});

test("before meetings: the coming ones with people get their summary once (with the briefing); off by the switch", async () => {
  await person();
  const { addEvent, zeffCalendar } = await import("@/lib/calendar/ir");
  const start = new Date(NOW.getTime() + 90 * 60e3);
  const e = addEvent(zeffCalendar().id, { title: "Konzept mit Jonas", start: local(start), end: local(new Date(start.getTime() + 3600e3)), attendees: ["jonas@example.com"] });
  addEvent(zeffCalendar().id, { title: "Später", start: local(new Date(NOW.getTime() + 10 * 3600e3)), end: local(new Date(NOW.getTime() + 11 * 3600e3)), attendees: ["jonas@example.com"] });
  const { prepareMeetingBriefs, cachedSummary, setAutoSummary } = await import("@/plugins/know/summary");
  const { ai, calls } = fakeAi({ points: [{ text: "Konzept ist überfällig", sources: [1] }] });
  setAutoSummary(false);
  assert.equal((await prepareMeetingBriefs({ now: NOW, ai, health: [] })).made, 0);
  setAutoSummary(true);
  const r = await prepareMeetingBriefs({ now: NOW, ai, health: [] });
  assert.equal(r.made, 1, "only the one within the next hours");
  assert.equal(calls.length, 1);
  assert.ok(cachedSummary(`event:${e.id}`, null));
  assert.equal((await prepareMeetingBriefs({ now: NOW, ai, health: [] })).made, 0, "nothing changed: no second call");
  assert.equal(calls.length, 1);
});

test("your verdict on a summary goes to the learning ledger", async () => {
  const { rateSummary } = await import("@/plugins/know/summary");
  const { ledgerDb } = await import("@/lib/learning/ledger");
  rateSummary("event:1", "rejected");
  const row = ledgerDb().prepare("select step, item_ref, verdict from ai_feedback where step = 'know-summary'").get() as { step: string; item_ref: string; verdict: string };
  assert.deepEqual(row, { step: "know-summary", item_ref: "event:1", verdict: "rejected" });
});
