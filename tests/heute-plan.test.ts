import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ROOT, setupTempData } from "./helpers";

// "Plan my day": the AI (a fake Claude CLI answers: tests/fake-claude-json.mjs) orders today's todos into time blocks around the
// appointments; a block over an appointment (or another block) or outside the day is dropped. Applied, the blocks are proposed
// appointments in the Zeff calendar — the day's replaced when planned again, a dismissed one not proposed again.
const dir = setupTempData();
process.env.CLAUDE_CLI = path.join(ROOT, "tests", "fake-claude-json.mjs");
const promptFile = path.join(dir, "prompt.txt");
process.env.FAKE_CLAUDE_PROMPT_FILE = promptFile;

const DAY = "2026-11-02";

test("fitBlocks: drops what overlaps an appointment or an earlier block, lies outside the window or ends before it starts", async () => {
  const { fitBlocks } = await import("@/lib/heute-plan");
  const b = (title: string, from: string, to: string) => ({ title, start: `${DAY}T${from}`, end: `${DAY}T${to}`, todoId: null });
  const busy = [{ start: `${DAY}T10:00`, end: `${DAY}T11:00` }];
  const kept = fitBlocks([b("C", "11:00", "12:00"), b("A", "08:30", "09:30"), b("over the meeting", "09:45", "10:15"), b("over A", "09:00", "09:15"), b("too early", "07:00", "08:30"), b("backwards", "13:00", "12:00")], busy, `${DAY}T08:00`, `${DAY}T18:00`);
  assert.deepEqual(kept.map((x) => x.title), ["A", "C"]);
});

test("plan my day: one AI call with today's todos and appointments; applied as proposals in the Zeff calendar, replaced when planned again", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["llm", "claude-cli", "todos", "calendar"]) setInstalled(id, true);
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ aiProvider: "claude" });
  const ir = await import("@/lib/calendar/ir");
  ir.addEvent(ir.zeffCalendar().id, { title: "Jour fixe", start: `${DAY}T10:00`, end: `${DAY}T11:00` });
  const store = await import("@/lib/todos/store");
  const report = store.addManualTodo({ ticket: "", text: "Bericht schreiben" });
  store.setTodoDue(report.id, DAY);
  const call = store.addManualTodo({ ticket: "", text: "Anna anrufen" });
  store.setTodoDue(call.id, "2026-10-30");
  store.addManualTodo({ ticket: "", text: "Irgendwann aufräumen" });

  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({
    note: "Erst das Schwierige.",
    blocks: [
      { todo: String(report.id), title: "Bericht schreiben", start: "08:30", end: "10:00" },
      { todo: String(call.id), title: "Anna anrufen", start: "10:30", end: "11:00" },
      { todo: String(call.id), title: "Anna anrufen", start: "11:00", end: "11:30" },
      { todo: "", title: "Pause", start: "nonsense", end: "12:00" },
    ],
  });
  const { planDay, applyDayPlan } = await import("@/lib/heute-plan");
  const plan = await planDay(new Date(`${DAY}T08:05:00`));
  const prompt = fs.readFileSync(promptFile, "utf8");
  assert.match(prompt, /Bericht schreiben/);
  assert.match(prompt, /Anna anrufen/);
  assert.doesNotMatch(prompt, /Irgendwann aufräumen/, "only what is due today or before");
  assert.match(prompt, /Jour fixe/);
  assert.equal(plan.day, DAY);
  assert.equal(plan.note, "Erst das Schwierige.");
  assert.deepEqual(
    plan.blocks.map((b) => `${b.start.slice(11)}–${b.end.slice(11)} ${b.title} #${b.todoId}`),
    [`08:30–10:00 Bericht schreiben #${report.id}`, `11:00–11:30 Anna anrufen #${call.id}`],
    "not over the appointment, nothing malformed",
  );

  const calendars = ir.listCalendars().length;
  const first = applyDayPlan(DAY, plan.blocks);
  assert.equal(first.count, 2);
  assert.equal(first.calendarId, ir.zeffCalendar().id, "in the Zeff calendar");
  assert.equal(ir.listCalendars().length, calendars, "no calendar made");
  const proposedOf = () =>
    ir.eventsBetween(`${DAY}T00:00`, `${DAY}T23:59`, { proposals: true }).filter((e) => e.proposed).map((e) => `${e.start.slice(11)} ${e.title}`);
  assert.deepEqual(proposedOf(), ["08:30 Bericht schreiben", "11:00 Anna anrufen"]);
  const { openProposals, decide } = await import("@/lib/proposals");
  const open = () => openProposals("calendar").map((p) => [p.kind, (p.payload as { title: string }).title]);
  assert.deepEqual(open(), [["event", "Bericht schreiben"], ["event", "Anna anrufen"]], "each block a proposal (the review lists them)");
  // One dismissed: gone, and not proposed again when the day is planned once more.
  const anna = openProposals("calendar").find((p) => (p.payload as { title: string }).title === "Anna anrufen")!;
  await decide(anna.id, "dismissed");
  assert.deepEqual(proposedOf(), ["08:30 Bericht schreiben"]);
  const again = applyDayPlan(DAY, plan.blocks);
  assert.equal(again.count, 1, "the dismissed block stays out");
  assert.deepEqual(proposedOf(), ["08:30 Bericht schreiben"]);
  const second = applyDayPlan(DAY, [{ title: "Nur noch das", start: `${DAY}T14:00`, end: `${DAY}T15:00`, todoId: report.id }, { title: "Über dem Jour fixe", start: `${DAY}T10:15`, end: `${DAY}T10:45`, todoId: null }]);
  assert.equal(second.calendarId, first.calendarId, "the same calendar");
  assert.deepEqual(proposedOf(), ["14:00 Nur noch das"], "replaced, and never over an appointment");
  assert.deepEqual(open(), [["event", "Nur noch das"]], "the replaced ones' proposals expired");
  assert.deepEqual(ir.busyBetween(new Date(`${DAY}T00:00`), new Date(`${DAY}T23:59`)).map((b) => b.title), ["Jour fixe"], "the plan blocks no time");
});
