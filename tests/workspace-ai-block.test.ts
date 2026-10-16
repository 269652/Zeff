import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ROOT, setupTempData } from "./helpers";

// AI in any page: an AI block writes by its instruction from what the page holds — its text and the databases shown in it
// (their rows, keys, status, AI fields). Kept in the page; refreshed by hand or, when set to, with the briefing.
const dir = setupTempData();
process.env.CLAUDE_CLI = path.join(ROOT, "tests", "fake-claude-json.mjs");
const promptFile = path.join(dir, "prompt.txt");
process.env.FAKE_CLAUDE_PROMPT_FILE = promptFile;

const setup = async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["llm", "claude-cli", "workspace"]) setInstalled(id, true);
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ aiProvider: "claude" });
};

test("aiBlock: kept by the document, Markdown both ways", async () => {
  const d = await import("@/plugins/workspace/doc");
  const doc = d.sanitizeDoc({ type: "doc", content: [{ type: "aiBlock", attrs: { prompt: "Die Gesamtlage", text: "Alles gut.", at: "2026-10-16T08:00:00Z", auto: true, evil: 1 } }] });
  assert.deepEqual(doc.content[0], { type: "aiBlock", attrs: { prompt: "Die Gesamtlage", text: "Alles gut.", at: "2026-10-16T08:00:00Z", auto: true } });
  const md = d.docToMarkdown(doc).trim();
  assert.equal(md, ":::ai auto Die Gesamtlage\nAlles gut.\n:::");
  assert.deepEqual(d.markdownToDoc(md).content[0], { type: "aiBlock", attrs: { prompt: "Die Gesamtlage", text: "Alles gut.", at: "", auto: true } });
});

test("writeAiBlock: from the page and the databases in it; refreshAiBlocks keeps the auto ones current", async () => {
  await setup();
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const { writeAiBlock, refreshAiBlocks } = await import("@/plugins/workspace/ai-block");
  const status = m.newProperty("Status", "status");
  const dbId = w.createPage({ kind: "database", title: "Tickets", schema: { titleName: "Name", properties: [status, { ...m.newProperty("Key", "text"), id: "ticketkey" }], views: [m.newView("Table")] } });
  w.addRow(dbId, { title: "Export kaputt", cells: { ticketkey: "PROJ-1", [status.id]: status.options![1].id } });
  const pageId = w.createPage({
    title: "Meine Lage",
    content: { type: "doc", content: [{ type: "aiBlock", attrs: { prompt: "Die Gesamtlage in drei Sätzen", text: "", at: "", auto: true } }, { type: "paragraph", content: [{ type: "text", text: "Fokus diese Woche: Release." }] }, { type: "databaseView", attrs: { dbId, viewId: "", title: "Tickets" } }] },
  });

  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ text: "Der Export hängt, Release in Gefahr." });
  const text = await writeAiBlock(pageId, "Die Gesamtlage in drei Sätzen");
  assert.equal(text, "Der Export hängt, Release in Gefahr.");
  const prompt = fs.readFileSync(promptFile, "utf8");
  assert.match(prompt, /Die Gesamtlage in drei Sätzen/);
  assert.match(prompt, /Fokus diese Woche: Release\./, "the page's text");
  assert.match(prompt, /PROJ-1.*Export kaputt.*In progress/, "the rows of the database shown in it");

  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ text: "Neu geschrieben." });
  const r = await refreshAiBlocks();
  assert.equal(r.written, 1);
  const block = w.getPage(pageId)!.content.content[0];
  assert.equal(block.attrs?.text, "Neu geschrieben.", "the auto block is rewritten in the page");
  assert.ok(String(block.attrs?.at).length > 0);
  assert.equal(w.getPage(pageId)!.content.content.length, 3, "the rest of the page as it was");
});

test("a view can show only your rows (saved)", async () => {
  const m = await import("@/plugins/workspace/model");
  const v = { ...m.newView("Mine"), mine: true };
  const s = m.normalizeSchema({ titleName: "Name", properties: [], views: [v] });
  assert.equal(s.views[0].mine, true);
});
