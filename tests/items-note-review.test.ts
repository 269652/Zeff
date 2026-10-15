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
  const { listTodos } = await import("@/lib/boards/store");
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
  const { listTodos } = await import("@/lib/boards/store");
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
