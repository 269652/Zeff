import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("about me: one record — set from anywhere, read the same everywhere, in every AI prompt", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("llm", true);
  const about = await import("@/lib/about-me");
  const { getLlmSettings } = await import("@/plugins/llm/settings");
  const { llmPreamble } = await import("@/plugins/llm/run");
  await about.setAboutMe("Ich unterrichte F4 an einer Berufsschule.");
  assert.equal(about.aboutMe(), "Ich unterrichte F4 an einer Berufsschule.");
  assert.equal(getLlmSettings().context, "Ich unterrichte F4 an einer Berufsschule.", "the AI settings' field is the same record");
  assert.match(llmPreamble(), /Ich unterrichte F4/, "in every prompt");
});

test("about me with its page in System → Prompts: written there too; an edit of the page is what everyone reads", async () => {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("llm", true);
  setInstalled("workspace", true);
  const about = await import("@/lib/about-me");
  const prompts = await import("@/lib/prompts");
  const ws = await import("@/plugins/workspace/store");
  const { markdownToDoc } = await import("@/plugins/workspace/doc");
  await prompts.ensureSystemPrompts();
  const pageId = prompts.systemPromptPages().find((p) => p.key === "llm-context")?.pageId;
  assert.ok(pageId, "the page is there");
  await about.setAboutMe("Ich bin Lehrerin für Mathe.");
  assert.equal(about.aboutMe(), "Ich bin Lehrerin für Mathe.");
  assert.match(JSON.stringify(ws.getPage(pageId)!.content), /Lehrerin für Mathe/, "the page shows it");
  // Changed on the page itself: that's the record now — the settings show it, the prompts use it.
  ws.updatePage(pageId, { content: markdownToDoc("Ich unterrichte F4 und Physik.") });
  assert.equal(about.aboutMe(), "Ich unterrichte F4 und Physik.");
  // And set again from the settings: the page follows.
  await about.setAboutMe("Ich unterrichte F4, Physik und Chemie.");
  assert.match(JSON.stringify(ws.getPage(pageId)!.content), /Chemie/);
  assert.equal(about.aboutMe(), "Ich unterrichte F4, Physik und Chemie.");
});

test("about me: too long is refused, empty is fine", async () => {
  const about = await import("@/lib/about-me");
  await assert.rejects(about.setAboutMe("x".repeat(6001)));
  await about.setAboutMe("");
  assert.equal(about.aboutMe(), "");
});
