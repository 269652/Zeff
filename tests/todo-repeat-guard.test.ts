import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ROOT, setupTempData } from "./helpers";

// A todo that comes back can't be skipped by mistake: the next one waits set aside until a week before its day, ticking it off before
// that asks first, and its words are the AI's for the repeats (a fake Claude CLI answers: tests/fake-claude-json.mjs).
const dir = setupTempData();
process.env.CLAUDE_CLI = path.join(ROOT, "tests", "fake-claude-json.mjs");
const promptFile = path.join(dir, "prompt.txt");
process.env.FAKE_CLAUDE_PROMPT_FILE = promptFile;

const day = (n: number) => new Date(Date.now() + n * 864e5).toLocaleDateString("sv-SE");

async function rate(text: string) {
  const { addManualTodo, setTodoDue } = await import("@/lib/todos/store");
  const { setRecurrence } = await import("@/lib/todos/recurring");
  const t = addManualTodo({ ticket: "KB-9", text });
  setTodoDue(t.id, day(-1));
  setRecurrence(t.id, { freq: "monthly", interval: 1 });
  return t;
}

test("ticked off, the next one waits set aside — until a week before its day, then it comes up saying so", async () => {
  const { getTodo, listTodos, setTodoStatus } = await import("@/lib/todos/store");
  const { deferral } = await import("@/lib/todos/deferral");
  const t = await rate("Rate 120 € (Az. 1/26) überweisen");
  setTodoStatus(t.id, "done");
  const next = listTodos({ status: "open" }).find((x) => x.text.includes("Az. 1/26"))!;
  assert.ok(getTodo(next.id)!.deferredAt, "set aside");
  assert.deepEqual(deferral([getTodo(next.id)!])[next.id], { deferred: true }, "still down: weeks to go");
  const soon = { ...getTodo(next.id)!, due: day(5) };
  assert.match(deferral([soon])[next.id].bubbledUp ?? "", /5/, "a week before: up, with its days");
});

test("a repeat ticked off weeks before its day asks first; yes does it, a due one is done at once", async () => {
  const { getTodo, listTodos, setTodoStatus } = await import("@/lib/todos/store");
  const { setTodoStatusAction } = await import("@/plugins/todos/server-actions");
  const t = await rate("Garagenmiete 80 € an Herrn Koch zahlen");
  setTodoStatus(t.id, "done");
  const next = listTodos({ status: "open" }).find((x) => x.text.includes("Garagenmiete"))!;
  const r = await setTodoStatusAction(next.id, "done");
  assert.equal(r?.ok, false);
  assert.match(r?.confirm ?? "", /only due on/);
  assert.equal(getTodo(next.id)!.status, "open", "not done without a yes");
  assert.equal((await setTodoStatusAction(next.id, "done", { early: true }))?.ok, true);
  assert.equal(getTodo(next.id)!.status, "done");
  // One that is due (or past) is ticked off as ever.
  const due = await rate("Beitrag für den Sportverein abbuchen lassen");
  assert.equal((await setTodoStatusAction(due.id, "done"))?.ok, true);
});

test("the AI writes the repeats' words once; the next todo carries them — and a text changed by hand has them written again", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["llm", "claude-cli"]) setInstalled(id, true);
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ aiProvider: "claude" });
  const { getTodo, listTodos, setTodoStatus, setTodoText } = await import("@/lib/todos/store");
  const { writeRepeatTexts } = await import("@/lib/todos/repeat-text-ai");
  const t = await rate("Anzahlung 500 € (Az. 4/26) zunächst überweisen, dann monatlich 100 €");
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ todos: [{ id: t.id, text: "Monatsrate 100 € (Az. 4/26) überweisen" }] });
  const r = await writeRepeatTexts([t.id]);
  assert.equal(r.written, 1, r.error);
  assert.match(fs.readFileSync(promptFile, "utf8"), /Anzahlung 500 €/, "the todo is in the prompt");
  assert.equal(getTodo(t.id)!.recurrence!.text, "Monatsrate 100 € (Az. 4/26) überweisen");
  assert.equal((await writeRepeatTexts([t.id])).written, 0, "once");
  setTodoStatus(t.id, "done");
  const next = listTodos({ status: "open" }).find((x) => x.text.includes("Az. 4/26"))!;
  assert.equal(next.text, "Monatsrate 100 € (Az. 4/26) überweisen");
  assert.equal(next.recurrence!.text, "Monatsrate 100 € (Az. 4/26) überweisen", "and the ones after it");
  setTodoText(next.id, "Monatsrate 120 € (Az. 4/26) überweisen");
  assert.equal(getTodo(next.id)!.recurrence!.text, undefined, "written again for the new words");
});
