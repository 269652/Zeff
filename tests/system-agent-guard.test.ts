import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * System pages (the prompts, the detail views, the instructions) can be changed by you — never by the AI: what an AI tool
 * writes (the MCP server, the Workspace chat, an auto action) runs in an agent scope, and the store refuses there. Otherwise
 * a prepared mail could change a prompt for good.
 */
test("agent scope: system pages and what's under them are read-only for the AI's tools; you change them freely", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "todos"]) setInstalled(id, true);
  const w = await import("@/plugins/workspace/store");
  const p = await import("@/lib/prompts");
  const { markdownToDoc } = await import("@/plugins/workspace/doc");
  const { agentScope } = await import("@/plugins/workspace/agent-scope");
  const { newInstruction } = await import("@/plugins/workspace/instructions");
  await p.ensureSystemPrompts();
  const prompt = (await p.systemPrompts()).find((x) => x.key === "ticket-lage")!.pageId!;
  const mine = await newInstruction("Mein Prompt");
  const plain = w.createPage({ title: "Normale Seite" });

  // You: free.
  w.updatePage(prompt, { content: markdownToDoc("von mir") });
  w.updatePage(mine, { content: markdownToDoc("auch von mir") });

  // The AI's tools: system pages and what is under them — no; a normal page — yes.
  await agentScope.run(true, async () => {
    assert.throws(() => w.updatePage(prompt, { content: markdownToDoc("injiziert") }), /only be changed by you/i);
    assert.throws(() => w.updatePage(mine, { title: "x" }), /only be changed by you/i, "under a system page (My prompts)");
    assert.throws(() => w.createPage({ title: "x", parentId: prompt }), /only be changed by you/i, "no new page under it");
    assert.throws(() => w.archivePage(mine), /only be changed by you|stays/i);
    w.updatePage(plain, { title: "Geändert" });
    assert.equal(w.getPage(plain)!.title, "Geändert");
    assert.ok(w.getPage(prompt)!.title, "readable");
  });
  assert.doesNotMatch(JSON.stringify(w.getPage(prompt)!.content), /injiziert/);

  // The Workspace's API methods run in the scope too (zeff-do): a prompt can't be appended to.
  await import("@/plugins/contributions");
  const { offeredMethods } = await import("@/plugins/actions/server");
  const append = offeredMethods()["workspace.pages.append"];
  const target = w.getPage(prompt)!.title;
  assert.equal(append.offer.check({ page: target, markdown: "x" }), null, "not even offered as a target");
  await assert.rejects(Promise.resolve(append.run({ page: String(prompt), markdown: "x" }, { plugin: "t", has: () => true } as never)), /only be changed by you|not found|no such page/i);
});
