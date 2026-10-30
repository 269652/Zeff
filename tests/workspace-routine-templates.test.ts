import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Agents, automations, the jobs for agents and the rules are features, not templates: the "+" menu's "Automation …" makes each — an
 * agent or an automation is a page with its routine (its name the title, its controls a block at the top).
 */
test("automation: Agent and Automation — a page with a routine, off, started by hand; the controls block first, then the instructions", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "work", "todos"]) setInstalled(id, true);
  const w = await import("@/plugins/workspace/store");
  const r = await import("@/plugins/workspace/routines");
  const { AUTOMATION_KINDS, createAutomation } = await import("@/plugins/workspace/automation-new");
  const { docText } = await import("@/plugins/workspace/doc");
  assert.deepEqual(
    AUTOMATION_KINDS().map((k) => k.key),
    ["agent", "automation", "jobs", "rules"],
  );
  assert.ok(AUTOMATION_KINDS().every((k) => k.name && k.icon && k.description));

  const project = w.createPage({ title: "Projekt" });
  const agent = createAutomation("agent", project);
  const page = w.getPage(agent)!;
  assert.equal(page.parentId, project, "it can be a sub page: it knows its parent");
  assert.ok(page.title, "a name as title");
  const rt = r.getRoutine(agent)!;
  assert.deepEqual([rt.kind, rt.enabled, rt.triggers.map((t) => t.kind), rt.permissions.scope], ["agent", false, ["manual"], "self"]);
  const blocks = (page.content as { content: { type: string }[] }).content;
  assert.equal(blocks[0].type, "zeffRoutine", "the controls come first");
  assert.ok(blocks.length > 1 && docText(page.content).trim().length > 0, "and a block to write the first instruction in");

  const auto = createAutomation("automation", null);
  const ra = r.getRoutine(auto)!;
  assert.deepEqual([ra.kind, ra.enabled, ra.steps.length], ["automation", false, 0]);
  assert.equal((w.getPage(auto)!.content as { content: { type: string }[] }).content[0].type, "zeffRoutine");
  assert.throws(() => createAutomation("nope", null));
});

test("automation: the jobs for agents and the rules are databases of their kind — and none of the four is a template any more", async () => {
  const w = await import("@/plugins/workspace/store");
  const { createAutomation } = await import("@/plugins/workspace/automation-new");
  const parent = w.createPage({ title: "Werkstatt" });
  const jobs = w.getDatabase(createAutomation("jobs", parent))!;
  assert.ok(jobs.schema.jobs && jobs.page.parentId === parent);
  assert.ok(w.getDatabase(createAutomation("rules", null))!.schema.rules);
  const { templateMetas } = await import("@/plugins/workspace/templates");
  const keys = templateMetas().map((m) => m.key);
  for (const k of ["agent", "automation", "agent-jobs", "rules", "news-summary"]) assert.ok(!keys.includes(k), k);
  assert.ok(!templateMetas().some((m) => (m.category as string) === "automation"));
});
