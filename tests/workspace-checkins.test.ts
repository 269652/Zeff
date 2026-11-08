import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Questions to you, as building blocks: one place for them all (asks.ts) — a flow's question waits for the answer (checked against
 * its fields), a newer one replaces one still open, an unanswered one lapses; an agent's question waits and gives the answer back; a
 * schedule keeps to its hours and days; a check-in is an ordinary flow of blocks — ask, make sure of the database (in the journal),
 * write the row — and the review beside it is told of it.
 */

async function world() {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "todos", "studio"]) setInstalled(id, true);
  await import("@/plugins/contributions");
  return { w: await import("@/plugins/workspace/store"), s: await import("@/plugins/workspace/flows/store"), e: await import("@/plugins/workspace/flows/engine"), a: await import("@/plugins/workspace/asks") };
}
let n = 0;

test("a flow's question: one of the questions to you, checked, replaced by a newer one, lapsing unanswered", async () => {
  const { s, e, a } = await world();
  const f = s.createFlow({ name: `ask.t${++n}`, nodes: [{ id: "ask", kind: "ask", title: "Wie geht es dir?", fields: [{ name: "value", kind: "scale", min: 1, max: 10 }, { name: "note", kind: "text" }], expiresMinutes: 50 }], output: "{{ steps.ask.value }}" });
  const first = await e.runFlow(f);
  assert.equal(first.status, "waiting");
  assert.ok(a.openAsks().some((x) => x.id === first.waiting?.askId && x.title === "Wie geht es dir?"), "with the questions to you");
  await assert.rejects(() => e.resumeFlowRun(first.runId, { answers: { value: 11 } }), /from 1 to 10/);
  await assert.rejects(() => a.answerAsk(first.waiting!.askId!, {}), /needs an answer/);
  const second = await e.runFlow(f);
  assert.equal(s.getFlowRun(first.runId)!.status, "cancelled", "the newer question replaced the open one");
  assert.equal(a.getAsk(first.waiting!.askId!)!.status, "cancelled");
  await a.answerAsk(second.waiting!.askId!, { value: "7" });
  const done = s.getFlowRun(second.runId)!;
  assert.equal(done.status, "done");
  assert.equal(done.output, 7, "a scale's answer is a number");
  const third = await e.runFlow(f);
  assert.ok((await e.resumeDueFlows(new Date(Date.now() + 51 * 60000))) >= 1);
  assert.equal(s.getFlowRun(third.runId)!.status, "cancelled");
  assert.match(s.getFlowRun(third.runId)!.error ?? "", /no answer in time/);
});

test("an approval is a question with a choice; an agent's question waits for the answer and gets it back", async () => {
  const { s, e, a } = await world();
  const f = s.createFlow({ name: `ok.t${++n}`, nodes: [{ id: "ok", kind: "approve", title: "Bestellen?", options: ["ja", "nein"] }], output: "{{ steps.ok.choice }}" });
  const r = await e.runFlow(f);
  const ask = a.getAsk(r.waiting!.askId!)!;
  assert.deepEqual(ask.fields.map((x) => x.kind), ["choice", "text"]);
  const done = await e.resumeFlowRun(r.runId, { choice: "ja" });
  assert.equal(done.output, "ja");

  const q = await a.askUser({ title: "Welcher Ordner?", fields: [{ name: "answer", kind: "text", required: true }], source: { kind: "agent", label: "Aufräumen" }, from: "Aufräumen" });
  const waiting = a.waitForAnswer(q.id, 10000);
  setTimeout(() => void a.answerAsk(q.id, { answer: "Archiv 2026" }), 300);
  const got = await waiting;
  assert.equal(got?.status, "answered");
  assert.equal(got?.answers?.answer, "Archiv 2026");
  const late = await a.askUser({ title: "Noch was?", fields: [{ name: "answer", kind: "text" }], source: { kind: "agent", label: "x" }, from: "x" });
  assert.equal(await a.waitForAnswer(late.id, 100), null, "not answered (yet): it says so");
});

test("a schedule every hour keeps to its hours and days", async () => {
  const { e } = await world();
  const at = (v: string) => new Date(v);
  const t = { everyMinutes: 60, from: "08:00", to: "22:00" };
  assert.equal(e.nextFlowRunAfter(t, at("2026-11-09T09:00:00"))!.getHours(), 10);
  const night = e.nextFlowRunAfter(t, at("2026-11-09T21:30:00"))!;
  assert.deepEqual([night.getDate(), night.getHours(), night.getMinutes()], [10, 8, 0], "after 22:00: the next morning at 8");
  const weekdays = e.nextFlowRunAfter({ ...t, days: [1, 2, 3, 4, 5] }, at("2026-11-13T21:30:00")); // a Friday
  assert.deepEqual([weekdays!.getDay(), weekdays!.getHours()], [1, 8], "over the weekend: Monday morning");
});

test("the check-in start: blocks — ask, make sure of the database in the journal, write — and the review beside it is told", async () => {
  const { w, s, e, a } = await world();
  const journal = w.createPage({ title: "Journal" });
  w.createPage({ parentId: journal, kind: "database", title: "Journal entries" });
  const { STARTERS } = await import("@/plugins/studio/starters");
  const f = s.createFlow(STARTERS.find((x) => x.id === "checkin")!.def(`checkin.t${++n}`));
  const { checkFlow } = await import("@/plugins/workspace/flows/check");
  assert.deepEqual(checkFlow(f), []);
  assert.deepEqual(f.nodes.map((x) => (x.kind === "action" ? x.action : x.kind)), ["ask", "db.ensure", "db.insert"], "nothing but blocks");

  const r = await e.runFlow(f, {}, { trigger: f.triggers[0] });
  await a.answerAsk(r.waiting!.askId!, { value: 8, note: "Kaffee" });
  assert.equal(s.getFlowRun(r.runId)!.status, "done", s.getFlowRun(r.runId)!.error ?? "");
  const db = w.tree().find((p) => p.kind === "database" && p.title === "Check-ins")!;
  assert.equal(db.parentId, journal, "made in the journal");
  assert.deepEqual(s.flowByName(f.name)!.permissions.write, [db.id], "it may write what it made — and nothing else");
  const d = w.rowsOf(db.id)!;
  const cell = (name: string) => d.rows[0].cells[d.schema.properties.find((p) => p.name === name)!.id];
  assert.equal(cell("Answer"), 8);
  assert.equal(cell("Note"), "Kaffee");
  assert.match(String(cell("When")), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "with its time");

  // Again: the same database, a second row.
  const r2 = await e.runFlow(s.flowByName(f.name)!, {}, { trigger: f.triggers[0] });
  await a.answerAsk(r2.waiting!.askId!, { value: 6 });
  assert.equal(w.tree().filter((p) => p.title === "Check-ins").length, 1);
  assert.equal(w.rowsOf(db.id)!.rows.length, 2);

  const { renderView } = await import("@/plugins/workspace/view-template");
  const dd = w.rowsOf(db.id)!;
  const drawn = renderView(dd.schema.views[0].template!, { rows: dd.rows, props: dd.schema.properties, titleName: dd.schema.titleName, state: {}, app: {}, db: { id: db.id, title: "X" } });
  assert.deepEqual(drawn.errors, []);

  const agent = w.createPage({ parentId: journal, title: "Weekly review" });
  const { createRoutine } = await import("@/plugins/workspace/routines");
  createRoutine(agent, "agent", { triggers: [{ kind: "manual" }] });
  const { buildAgentPrompt } = await import("@/plugins/workspace/routine-agent");
  const prompt = buildAgentPrompt(agent, { kind: "manual" });
  assert.match(prompt, /## Daten neben dir/);
  assert.match(prompt, new RegExp(`Datenbank ${db.id}\\): 2 Zeilen`));
  assert.match(prompt, /zeff_ask/, "it may ask the user");
});
