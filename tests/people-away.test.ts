import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const day = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const ago = (d: number) => new Date(Date.now() - d * 864e5).toISOString();

async function seed() {
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["people", "todos"]) setInstalled(p, true);
  const { createPerson, listPeople } = await import("@/plugins/people/store");
  const had = listPeople().find((p) => p.name === "Ulla Nathanael");
  if (had) return { ogv: had.id, rico: listPeople().find((p) => p.name === "Rico Clemen")!.id };
  const { addClaim } = await import("@/plugins/people/graph");
  const ogv = createPerson({ name: "Ulla Nathanael", emails: ["ogv.nathanael@gvjustiz.de"] });
  const rico = createPerson({ name: "Rico Clemen", emails: ["rico@example.com"] });
  const [d, m, y] = day(9).split("-").reverse();
  addClaim({ personId: ogv, kind: "fact", text: `Urlaub bis ${d}.${m}.${y}; E-Mails werden nicht weitergeleitet.`, evidence: "nicht im Dienst", sourceRef: "mail:a", confidence: 0.9 });
  addClaim({ personId: ogv, kind: "commitment", text: "Sie teilt die Restrate schriftlich mit.", evidence: "teilt … mit", sourceRef: "doc:40", confidence: 0.9, direction: "theirs" });
  addClaim({ personId: rico, kind: "commitment", text: "Rico schickt die Figma-Nodes.", evidence: "Ich schicke dir die Nodes", sourceRef: "mail:r1", confidence: 0.9, direction: "theirs", due: day(-2) });
  addClaim({ personId: rico, kind: "commitment", text: "Ich schicke Rico das Briefing.", evidence: "schick ich dir", sourceRef: "mail:r2", confidence: 0.9, direction: "mine", due: day(-2) });
  return { ogv, rico };
}

test("away: who is away until when, read off what was said about them — and the todos that name them say so", async () => {
  const { ogv } = await seed();
  const { awayPeople, awayFor } = await import("@/plugins/people/away");
  const away = awayPeople(day(0));
  assert.deepEqual([...away.keys()], [ogv]);
  assert.equal(away.get(ogv)!.until, day(9));
  const todos = [
    { id: 1, text: "Bei Frau Nathanael nachfragen, ob die Raten aufs Dienstkonto gehen", note: null },
    { id: 2, text: "Rico wegen der Nodes fragen", note: null },
  ];
  const r = awayFor(todos as never, day(0));
  assert.deepEqual(Object.keys(r), ["1"]);
  assert.deepEqual(r[1].away, [{ personId: ogv, name: "Ulla Nathanael", until: day(9) }]);
  // Past the day: nobody is away.
  assert.equal(awayPeople(day(10)).size, 0);
});

test("follow-ups: what others promised and didn't keep — past its day, or a week old without one — asked in the review queue; not while they are away; yes makes a todo on its source, no isn't asked again", async () => {
  const { rico, ogv } = await seed();
  const { getSqlite } = await import("@/db");
  // The undated promise of the one away: a week old.
  getSqlite().prepare("update people_claims set created_at = ? where person_id = ? and kind = 'commitment'").run(ago(8), ogv);
  const { followUps } = await import("@/plugins/people/away");
  const due = followUps(day(0));
  assert.deepEqual(due.map((c) => c.text), ["Rico schickt die Figma-Nodes."], "not my own promise, not hers while she is away");

  const { reviewItems, reviewAct } = await import("@/lib/review");
  await import("@/plugins/contributions");
  const items = (await reviewItems()).items.filter((i) => i.key.startsWith("people-followup:"));
  assert.equal(items.length, 1);
  assert.match(items[0].title, /Rico/);
  await reviewAct(items[0].key, "yes");
  const { listTodos } = await import("@/lib/boards/store");
  const made = listTodos({ status: "open" }).find((t) => /Rico/.test(t.text) && /nachfassen/i.test(t.text));
  assert.ok(made, "a todo to follow up");
  assert.deepEqual(made!.refs, ["mail:r1"]);
  assert.equal(followUps(day(0)).length, 0, "asked once");
  void rico;
});

test("follow-ups: a question waiting on someone away comes up the day they are back — no week to wait", async () => {
  await seed();
  const { createPerson } = await import("@/plugins/people/store");
  const { addClaim } = await import("@/plugins/people/graph");
  const back = createPerson({ name: "Berta Rückkehr" });
  const [d, m, y] = day(-1).split("-").reverse();
  addClaim({ personId: back, kind: "fact", text: `Urlaub bis ${d}.${m}.${y}.`, evidence: "Urlaub", sourceRef: "mail:b0", confidence: 0.9 });
  addClaim({ personId: back, kind: "commitment", text: "Berta antwortet auf meine Frage zu den Raten.", evidence: "Antwort steht aus", sourceRef: "mail:b1", confidence: 0.9, direction: "theirs" });
  const { followUps } = await import("@/plugins/people/away");
  assert.ok(followUps(day(0)).some((c) => /Berta antwortet/.test(c.text)), "she is back since today: ask");
  assert.equal(followUps(day(-2)).some((c) => /Berta antwortet/.test(c.text)), false, "still away: not yet");
});
