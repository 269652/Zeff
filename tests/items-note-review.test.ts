import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ROOT, setupTempData } from "./helpers";

// The note review (Keep's extension for Todos): the AI (fake Claude CLI) reads the notes of the
// collections in the briefing and makes todos of them, the notes as their source.
const dir = setupTempData();
process.env.CLAUDE_CLI = path.join(ROOT, "tests", "fake-claude-json.mjs");
const promptFile = path.join(dir, "prompt.txt");
process.env.FAKE_CLAUDE_PROMPT_FILE = promptFile;

const setup = async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["llm", "claude-cli", "keep"]) setInstalled(id, true);
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ aiProvider: "claude" });
  return setInstalled;
};

test("note review: a Keep note's line in the prompt, its todo with the note as source", async () => {
  await setup();
  const k = await import("@/plugins/keep/boards");
  const { reviewNotesForTodos } = await import("@/plugins/keep/note-review");
  const { listTodos } = await import("@/lib/todos/store");
  const b = k.createKeepBoard({ name: "Privat" });
  const n = k.createOwnNote(b, { title: "Auto", text: "- [ ] Reifen wechseln\n- [x] TÜV", labels: ["Auto"] });
  // The AI names the note without its "keep:" prefix: Zeff adds it.
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ todos: [{ text: "Reifenwechsel-Termin vereinbaren", kind: "task", refs: [n.ref.slice(5)] }] });

  const r = await reviewNotesForTodos();
  assert.equal(r.ok, true, r.error);
  assert.equal(r.added, 1);
  const prompt = fs.readFileSync(promptFile, "utf8");
  assert.match(prompt, new RegExp(`- \\[${n.ref}\\] \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} \\(Privat, Labels: Auto\\) „Auto“ — ☐ Reifen wechseln\\n☑ TÜV`));
  const todo = listTodos({ status: "open" }).find((t) => t.text === "Reifenwechsel-Termin vereinbaren");
  assert.ok(todo);
  assert.deepEqual(todo.refs, [n.ref]);

  fs.rmSync(promptFile);
  const again = await reviewNotesForTodos();
  assert.equal(again.batches, 0, "read once: not again until it's edited");
  assert.ok(!fs.existsSync(promptFile));
});

test("note review: a Workspace database in the briefing is read too, its row the todo's source", async () => {
  const setInstalled = await setup();
  setInstalled("workspace", true);
  const w = await import("@/plugins/workspace/store");
  const { setCollection } = await import("@/lib/items");
  const { reviewNotesForTodos } = await import("@/plugins/keep/note-review");
  const { listTodos } = await import("@/lib/todos/store");
  const dbId = w.createPage({ kind: "database", title: "Haushalt" });
  const row = w.addRow(dbId, { title: "Steuer" });
  w.updatePage(row, { content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Erklärung bis 31.7. abgeben" }] }] } });
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ todos: [{ text: "Steuererklärung abgeben", kind: "task", refs: [`page:${row}`] }] });

  assert.equal((await reviewNotesForTodos()).batches, 0, "not in the briefing: not read");
  setCollection(`workspace:${dbId}`, { briefing: true });
  const r = await reviewNotesForTodos();
  assert.equal(r.added, 1, r.error);
  assert.match(fs.readFileSync(promptFile, "utf8"), new RegExp(`- \\[page:${row}\\] .* \\(Haushalt\\) „Steuer“ — Erklärung bis 31\\.7\\. abgeben`));
  assert.deepEqual(listTodos({ status: "open" }).find((t) => t.text === "Steuererklärung abgeben")?.refs, [`page:${row}`]);
});

test("note matching: a todo gets the notes it's about — Keep's, and rows of a database in the briefing", async () => {
  const setInstalled = await setup();
  setInstalled("workspace", true);
  const k = await import("@/plugins/keep/boards");
  const w = await import("@/plugins/workspace/store");
  const { setCollection } = await import("@/lib/items");
  const { relateNotes } = await import("@/plugins/keep/note-relations");
  const { addManualTodo, getTodo } = await import("@/lib/todos/store");
  const b = k.createKeepBoard({ name: "Urlaub" });
  const note = k.createOwnNote(b, { title: "Packliste Norwegen", text: "Regenjacke Wanderschuhe Norwegen Fähre" });
  const dbId = w.createPage({ kind: "database", title: "Reisen" });
  setCollection(`workspace:${dbId}`, { briefing: true });
  const row = w.addRow(dbId, { title: "Fähre Norwegen buchen" });
  w.updatePage(row, { content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Fähre Kiel Oslo Norwegen Termine" }] }] } });
  const todo = addManualTodo({ ticket: "", text: "Fähre nach Norwegen buchen" });
  assert.ok(todo && !("outcome" in todo && todo.outcome));
  const id = (todo as { id: number }).id;
  // The AI names the Keep note without its prefix.
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ todos: [{ id, notes: [note.ref.slice(5), `page:${row}`] }] });

  const r = await relateNotes();
  assert.equal(r.ok, true, r.error);
  const prompt = fs.readFileSync(promptFile, "utf8");
  assert.match(prompt, new RegExp(`  - \\[${note.ref}\\] \\(Urlaub\\) „Packliste Norwegen“ — Regenjacke`));
  assert.match(prompt, new RegExp(`  - \\[page:${row}\\] \\(Reisen\\) „Fähre Norwegen buchen“`));
  assert.deepEqual([...getTodo(id)!.refs].sort(), [note.ref, `page:${row}`].sort(), "its related notes");
});
