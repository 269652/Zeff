import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** An agent or an automation is made like any page: new page from a template — its name the title, its controls a block at the top. */
test("templates: Agent and Automation — a page with a routine, off, started by hand; the controls block first, then the instructions", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "work", "todos"]) setInstalled(id, true);
  const w = await import("@/plugins/workspace/store");
  const r = await import("@/plugins/workspace/routines");
  const { templateMetas, fromTemplate } = await import("@/plugins/workspace/templates");
  const { docText } = await import("@/plugins/workspace/doc");
  const metas = templateMetas();
  assert.ok(metas.some((m) => m.key === "agent" && m.kind === "page"), "an Agent template");
  assert.ok(metas.some((m) => m.key === "automation" && m.kind === "page"), "an Automation template");

  const project = w.createPage({ title: "Projekt" });
  const agent = fromTemplate("agent", project);
  const page = w.getPage(agent)!;
  assert.equal(page.parentId, project, "it can be a sub page: it knows its parent");
  assert.ok(page.title, "a name as title");
  const rt = r.getRoutine(agent)!;
  assert.deepEqual([rt.kind, rt.enabled, rt.triggers.map((t) => t.kind), rt.permissions.scope], ["agent", false, ["manual"], "self"]);
  const blocks = (page.content as { content: { type: string }[] }).content;
  assert.equal(blocks[0].type, "zeffRoutine", "the controls come first");
  assert.ok(blocks.length > 1 && docText(page.content).trim().length > 0, "and a block to write the first instruction in");

  const auto = fromTemplate("automation", null);
  const ra = r.getRoutine(auto)!;
  assert.deepEqual([ra.kind, ra.enabled, ra.steps.length], ["automation", false, 0]);
  assert.equal((w.getPage(auto)!.content as { content: { type: string }[] }).content[0].type, "zeffRoutine");
});
