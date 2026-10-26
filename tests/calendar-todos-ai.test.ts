import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ROOT, setupTempData } from "./helpers";

// Appointments become todos only when they give you something to do — the AI says so, once per appointment or series
// (a fake Claude CLI answers: tests/fake-claude-json.mjs). A blocker ("Pause", every day) is none.
const dir = setupTempData();
process.env.ZEFF_CALENDAR_INBOX = path.join(dir, "calendar-inbox.json");
process.env.GCAL_NO_SERVER = "1";
process.env.CLAUDE_CLI = path.join(ROOT, "tests", "fake-claude-json.mjs");
const promptFile = path.join(dir, "prompt.txt");
process.env.FAKE_CLAUDE_PROMPT_FILE = promptFile;

test("calendar todos: only appointments with something to do, a daily blocker none — judged once", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["llm", "claude-cli"]) setInstalled(id, true);
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ aiProvider: "claude" });
  const ir = await import("@/lib/calendar/ir");
  const { calendarTodos } = await import("@/lib/calendar/todos");
  const { addCalendarTodo, listTodos, todoByRef } = await import("@/lib/boards/store");

  const own = ir.createCalendar("Mein Kalender");
  const pause = ir.addEvent(own.id, { title: "Pause", start: "2026-11-02T12:30", end: "2026-11-02T13:00", recurrence: { freq: "daily", interval: 1 } });
  ir.addEvent(own.id, { title: "Kleider waschen", start: "2026-11-02T18:00", end: "2026-11-02T19:00" });
  // Made before the AI judged (the old way): today's "Pause" — it goes, untouched.
  addCalendarTodo({ text: "Pause (12:30)", due: "2026-11-02", ref: `event:${pause.id}@2026-11-02`, source: "Kalender „Mein Kalender“" });

  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ appointments: [{ id: "0", todo: false }, { id: "1", todo: true, text: "Kleider waschen" }] });
  const now = new Date("2026-11-02T08:00:00");
  assert.equal(await calendarTodos(now), 1);
  const prompt = fs.readFileSync(promptFile, "utf8");
  assert.match(prompt, /"title":"Pause"/);
  assert.equal(prompt.match(/"title":"Pause"/g)?.length, 1, "a series is asked once, not per day");

  const open = listTodos({ status: "open" }).filter((t) => t.source?.startsWith("Kalender"));
  assert.deepEqual(open.map((t) => t.text), ["Kleider waschen (18:00)"]);
  assert.equal(todoByRef(`event:${pause.id}@2026-11-02`)?.status, "dismissed");

  // Judged once: the next days' "Pause" is no todo either, without asking again.
  fs.rmSync(promptFile, { force: true });
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ appointments: [{ id: "0", todo: true }] });
  assert.equal(await calendarTodos(new Date("2026-11-03T08:00:00")), 0);
  assert.equal(fs.existsSync(promptFile), false, "no AI asked");
  assert.equal(todoByRef(`event:${pause.id}@2026-11-04`), undefined);
});
