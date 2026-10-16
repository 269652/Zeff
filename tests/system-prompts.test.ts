import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Every prompt Zeff uses is a page of the Workspace — System → Prompts → its group → the prompt: changed like any page,
 * not to be deleted or moved away, back to the built-in text with a click. The code reads it from there; an untouched page
 * gives the built-in text exactly. What was added to a step by hand ("Meine Anweisungen"), the LLM's instructions and the
 * workers' house rules move into their pages once — the prompts stay as they were.
 */
test("system prompts: pages made once, read by the code, protected, reset to the built-in text", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "todos", "kanban", "knowledge", "llm"]) setInstalled(id, true);
  const w = await import("@/plugins/workspace/store");
  const { markdownToDoc } = await import("@/plugins/workspace/doc");
  const { setStepPrefs } = await import("@/lib/boards/context-prefs");
  const { extraBlock } = await import("@/lib/boards/context-prefs");
  const p = await import("@/lib/prompts");
  const { INSTRUCTIONS } = await import("@/lib/boards/collect");

  // Before: the built-in text (and a step's own addition on top, as before).
  assert.equal(p.promptText("ticket-lage", INSTRUCTIONS), INSTRUCTIONS);
  setStepPrefs("lage", { extra: "Immer auch PROJ-1 erwähnen." });
  assert.match(extraBlock("lage"), /PROJ-1/);

  await p.ensureSystemPrompts();
  const pages = await p.systemPrompts();
  const lage = pages.find((x) => x.key === "ticket-lage")!;
  assert.ok(lage.pageId, "a page for the Ticket-Lage");
  const page = w.getPage(lage.pageId!)!;
  assert.equal(page.title, lage.title);
  const group = w.getPage(page.parentId!)!;
  const prompts = w.getPage(group.parentId!)!;
  assert.equal(prompts.title, "Prompts");
  assert.equal(w.getPage(prompts.parentId!)!.title, "System");

  // The addition moved into the page: the prompt is what it was, the addition isn't added twice.
  assert.equal(extraBlock("lage"), "", "not added on top any more");
  const now = p.promptText("ticket-lage", INSTRUCTIONS);
  assert.match(now, /Du erstellst meine Ticket-Lage/);
  assert.match(now, /Immer auch PROJ-1 erwähnen\./);
  assert.equal(lage.modified, true, "differs from the built-in text");

  // An untouched page: the built-in text exactly.
  const q = pages.find((x) => x.key === "ticket-questions")!;
  const { INSTRUCTIONS: QUESTIONS_INSTRUCTIONS } = await import("@/lib/boards/questions");
  assert.equal(p.promptText("ticket-questions", QUESTIONS_INSTRUCTIONS), QUESTIONS_INSTRUCTIONS);
  assert.equal(q.modified, false);

  // Changed by hand: the code reads the change.
  w.updatePage(q.pageId!, { content: markdownToDoc("Antworte nur mit Ja oder Nein.") });
  assert.equal(p.promptText("ticket-questions", QUESTIONS_INSTRUCTIONS), "Antworte nur mit Ja oder Nein.");

  // Protected: not deleted, not moved away (the folders neither).
  assert.throws(() => w.archivePage(q.pageId!), /system/i);
  assert.throws(() => w.movePage(q.pageId!, null), /system/i);
  assert.throws(() => w.archivePage(prompts.id), /system/i);
  assert.equal(p.isSystemPage(q.pageId!), true);

  // Back to the built-in text.
  await p.resetSystemPrompt(q.pageId!);
  assert.equal(p.promptText("ticket-questions", QUESTIONS_INSTRUCTIONS), QUESTIONS_INSTRUCTIONS);
  assert.equal((await p.systemPrompts()).find((x) => x.key === "ticket-questions")!.modified, false);

  // Made once: a second run makes nothing new.
  const count = w.tree().length;
  await p.ensureSystemPrompts();
  assert.equal(w.tree().length, count);
});

test("system prompts: the LLM's instructions and context, the workers' house rules — the settings' text moves into the page", async () => {
  const p = await import("@/lib/prompts");
  const w = await import("@/plugins/workspace/store");
  const { markdownToDoc } = await import("@/plugins/workspace/doc");
  const { saveLlmSettings, getLlmSettings } = await import("@/plugins/llm/settings");
  const { llmPreamble } = await import("@/plugins/llm/run");
  // (Made before: the pages exist already — the settings' text goes in when a page is made, so a fresh account here.)
  saveLlmSettings({ ...getLlmSettings(), instructions: "Sei knapp.", context: "Ich arbeite bei Acme." });
  const page = (await p.systemPrompts()).find((x) => x.key === "llm-instructions")!;
  w.updatePage(page.pageId!, { content: markdownToDoc("Sei sehr knapp.") });
  assert.match(llmPreamble(), /Sei sehr knapp\./, "the page wins over the setting");
  await p.resetSystemPrompt(page.pageId!);
  assert.doesNotMatch(llmPreamble(), /Sei sehr knapp/, "reset: no instructions of its own (as built in)");
});

test("system prompts can be chosen as instructions of an AI step (with their group), next to your own", async () => {
  const p = await import("@/lib/prompts");
  const { listInstructions, instructionText } = await import("@/plugins/workspace/instructions");
  await p.ensureSystemPrompts();
  const list = listInstructions();
  const lage = list.find((x) => x.title === "Lage" && !x.group);
  assert.ok(lage, "your own (KI-Anweisungen)");
  const sys = list.find((x) => x.title === "Ticket-Lage");
  assert.equal(sys?.group, "Todos & Lage", "a system prompt, by its group");
  assert.match(instructionText([sys!.id]), /Du erstellst meine Ticket-Lage/);
});
