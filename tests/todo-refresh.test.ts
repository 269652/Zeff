import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ROOT, setupTempData } from "./helpers";

// A note on a todo brings just that todo up to date at once (no whole run) — with a fake Claude CLI
// (tests/fake-claude-json.mjs) answering as the AI would: no Claude, no cost.
const dir = setupTempData();
process.env.CLAUDE_CLI = path.join(ROOT, "tests", "fake-claude-json.mjs");
const promptFile = path.join(dir, "prompt.txt");
process.env.FAKE_CLAUDE_PROMPT_FILE = promptFile;

async function setup() {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("llm", true);
  setInstalled("claude-cli", true);
  setInstalled("auto-actions", false);
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ aiProvider: "claude" });
}

test("a note rewrites its todo — the AI's answer applied, noted on the todo", async () => {
  await setup();
  const { addManualTodo, addTodoUserNote, getTodo } = await import("@/lib/boards/store");
  const { refreshTodo } = await import("@/lib/boards/todo-refresh");
  const todo = addManualTodo({ ticket: "", text: "Julia fragen, ob der Link ein Deployment braucht" });
  addTodoUserNote(todo.id, "Julia hat gesagt, sie meldet sich Montag — ich warte darauf.");
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ action: "update", text: "Auf Julias Antwort zum Deployment warten", kind: todo.kind, owner: "other", due: "2026-10-12", why: "Julia meldet sich Montag." });
  const r = await refreshTodo(todo.id);
  assert.equal(r?.action, "update");
  const after = getTodo(todo.id)!;
  assert.equal(after.text, "Auf Julias Antwort zum Deployment warten");
  assert.equal(after.owner, "other");
  assert.equal(after.due, "2026-10-12");
  assert.ok(after.userNotes.some((n) => n.by === "Zeff" && /Julia meldet sich Montag/.test(n.text)));
  // The AI got the note — marked as mine, first in rank.
  const prompt = fs.readFileSync(promptFile, "utf8");
  assert.match(prompt, /MEINE NOTIZEN/);
  assert.match(prompt, /sie meldet sich Montag/);
});

test("a note saying it's done closes the todo", async () => {
  await setup();
  const { addManualTodo, addTodoUserNote, getTodo } = await import("@/lib/boards/store");
  const { refreshTodo } = await import("@/lib/boards/todo-refresh");
  const todo = addManualTodo({ ticket: "", text: "Bestell-Link prüfen" });
  addTodoUserNote(todo.id, "Erledigt, hab ich gestern geprüft.");
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ action: "done", text: todo.text, kind: todo.kind, owner: "me", due: null, why: "Laut deiner Notiz gestern geprüft." });
  await refreshTodo(todo.id);
  assert.equal(getTodo(todo.id)!.status, "done");
});

test("nothing happens for a todo that's no longer open, or without the LLM plugin", async () => {
  await setup();
  const { addManualTodo, setTodoStatus } = await import("@/lib/boards/store");
  const { canRefreshTodo, refreshTodo } = await import("@/lib/boards/todo-refresh");
  const todo = addManualTodo({ ticket: "", text: "Etwas" });
  setTodoStatus(todo.id, "dismissed");
  assert.equal(await refreshTodo(todo.id), null);
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("llm", false);
  const open = addManualTodo({ ticket: "", text: "Noch etwas" });
  assert.equal(canRefreshTodo(open), false);
});
