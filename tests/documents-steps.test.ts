import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ROOT, setupTempData } from "./helpers";

// The Documents plugin's two steps after the briefing, with a fake Claude CLI answering as the AI
// would (tests/fake-claude-json.mjs): no Claude, no cost.
const dir = setupTempData();
process.env.CLAUDE_CLI = path.join(ROOT, "tests", "fake-claude-json.mjs");
const promptFile = path.join(dir, "prompt.txt");
process.env.FAKE_CLAUDE_PROMPT_FILE = promptFile;

async function setup() {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("llm", true);
  setInstalled("claude-cli", true);
  setInstalled("documents", true);
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ aiProvider: "claude" });
}

async function addDoc(name: string, text: string) {
  const { addDocument, setExtracted } = await import("@/plugins/documents/store");
  const { doc } = addDocument(name, Buffer.from(text), "text/plain");
  setExtracted(doc.id, text);
  return doc;
}

test("document review: a todo with its deadline, the document as its source — and a document is read once", async () => {
  await setup();
  const { reviewDocumentsForTodos, excerpt } = await import("@/plugins/documents/review");
  const { listTodos } = await import("@/lib/todos/store");
  const doc = await addDoc("Mahnung Badenova.txt", "Mahnung vor Sperrung. Bitte überweisen Sie 186,83 EUR bis zum 16.10.2026 auf das Vertragskonto 1285554639.");
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ todos: [{ text: "Mahnung der Badenova über 186,83 € bis 16.10. bezahlen", kind: "other", owner: "me", due: "2026-10-16", refs: [doc.ref] }, { text: "Ohne passende Quelle", refs: ["doc:999"] }] });
  const r = await reviewDocumentsForTodos(null);
  assert.deepEqual([r.ok, r.reviewed, r.added], [true, 1, 1]);
  const todo = listTodos({ status: "open" }).find((t) => /Badenova/.test(t.text))!;
  assert.deepEqual(todo.refs, [doc.ref]);
  assert.equal(todo.due, "2026-10-16");
  assert.equal(todo.source, "Dokument-Durchsicht");
  // The AI got the document with its name and text.
  assert.match(fs.readFileSync(promptFile, "utf8"), /\[doc:\d+\] „Mahnung Badenova\.txt“[\s\S]*186,83 EUR/);
  // Read once: the same document isn't gone through again (no AI call, no second todo).
  fs.rmSync(promptFile, { force: true });
  const again = await reviewDocumentsForTodos(null);
  assert.deepEqual([again.ok, again.reviewed, again.added, again.batches], [true, 0, 0, 0]);
  assert.equal(fs.existsSync(promptFile), false);
  // A long document: its beginning and its end.
  const long = `${"A".repeat(5000)}\n${"B".repeat(8000)}\nOffene Frage: Wer verankert den Baum?`;
  assert.match(excerpt(long), /^A{4500}[\s\S]*Zeichen ausgelassen[\s\S]*Wer verankert den Baum\?$/);
});

test("document matching: each todo gets the documents it is about — documents attached by hand stay", async () => {
  await setup();
  const { relateDocuments, candidates, words } = await import("@/plugins/documents/relations");
  const { addManualTodo, addTodoContext, getTodo } = await import("@/lib/todos/store");
  const mietvertrag = await addDoc("Mietvertrag Stockmattenweg.txt", "Mietvertrag Stockmattenweg Freiburg. Die Kündigungsfrist beträgt drei Monate, die Kaution 1500 EUR.");
  const handmade = await addDoc("Foto Zählerstand.txt", "Zählerstand Strom 4711");
  const todo = addManualTodo({ ticket: "", text: "Mietvertrag Stockmattenweg prüfen: Kündigungsfrist und Kaution klären" });
  addTodoContext(todo.id, [handmade.ref], "", "Dokument"); // attached by hand: in its refs
  const other = addManualTodo({ ticket: "", text: "Zahnarzt anrufen" });
  // The likeliest by shared words (two at least).
  const index = (await import("@/plugins/documents/store")).readableDocuments().map((d) => ({ d, w: words(`${d.name} ${d.abstract} ${d.text}`) }));
  assert.deepEqual(candidates(getTodo(todo.id)!, index).map((d) => d.ref), [mietvertrag.ref]);
  assert.deepEqual(candidates(getTodo(other.id)!, index), []);

  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ todos: [{ id: todo.id, docs: [mietvertrag.ref, "doc:999"] }] });
  const r = await relateDocuments();
  assert.equal(r.ok, true);
  const after = getTodo(todo.id)!;
  assert.deepEqual([...after.refs].sort(), [handmade.ref, mietvertrag.ref].sort());
  assert.deepEqual(getTodo(other.id)!.refs, []);
});
