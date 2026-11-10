import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * Blocks of your own over the MCP (mcp-blocks.ts): the assistant saves a block with its flows — checked on a database's rows
 * before anything is kept, its flows under "🧩 Blocks" with their permissions only asked for — lists it, and a view using it is
 * checked when it is added (mcp-db.ts).
 */

type Res = { isError?: boolean; content: { text: string }[] };

async function setup() {
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("workspace", true);
  const w = await import("@/plugins/workspace/store");
  const m = await import("@/plugins/workspace/model");
  const { registerWorkspaceTools } = await import("@/plugins/workspace/mcp");
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  const server = { registerTool: (name: string, _def: unknown, h: (...a: unknown[]) => unknown) => void handlers.set(name, h) };
  const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
  const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });
  const run = async (fn: () => unknown) => {
    try {
      return await fn();
    } catch (e) {
      return fail(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  registerWorkspaceTools(server as never, { run, ok, fail } as never);
  const call = (name: string, args: unknown) => handlers.get(name)!(args, {}) as Promise<Res>;
  const db = w.createPage({ kind: "database", title: "Deals", schema: { titleName: "Deal", properties: [{ id: "amt", name: "Amount", type: "number" }, { id: "own", name: "Owner", type: "text" }], views: [m.newView("Table")] } });
  w.addRow(db, { title: "Alpha", cells: { amt: 100, own: "Anna" } });
  return { call, db, w };
}

const text = (r: Res) => r.content.map((c) => c.text).join("\n");

test("a block saved with its flow, checked on the rows; mistakes refused with nothing kept; a view using it checked too", async () => {
  const { call, db, w } = await setup();
  const card = { name: "crm.card", description: "A deal in a line", params: [{ name: "amount", type: "text", default: "Amount" }], template: "<row><b>{{ title }}</b>{{ props.amount | field }} {{ Owner }}</row>", example: '<list source="rows"><use block="crm.card"/></list>' };

  // A field the database hasn't: refused on its rows, nothing kept.
  const bad = await call("workspace_save_block", { ...card, template: "<row>{{ Nope }}</row>", database: db });
  assert.equal(bad.isError, true);
  assert.match(text(bad), /Not saved — line 1: There is no “Nope”/);
  assert.match(text(await call("workspace_blocks", {})), /No blocks yet/);

  const saved = await call("workspace_save_block", { ...card, database: db });
  assert.ok(!saved.isError, text(saved));
  assert.match(text(saved), /<use block="crm\.card" amount="text"\?\/>/);

  // With a flow: saved as block.<name>.<flow> under "🧩 Blocks"; its permission only asked for.
  const finder = await call("workspace_save_block", {
    name: "web.finder",
    description: "Finds",
    template: '<data name="hits" flow="@search" with="q=x"/><button run="@search" label="Go"/>',
    flows: [{ name: "search", inputs: [{ name: "q", type: "text" }], nodes: [{ id: "get", kind: "action", action: "http.request", input: { url: "https://api.example.org/s" } }], permissions: { web: ["api.example.org"] } }],
  });
  assert.ok(!finder.isError, text(finder));
  assert.match(text(finder), /block\.web\.finder\.search/);
  assert.match(text(finder), /asks for web/);
  const fs = await import("@/plugins/workspace/flows/store");
  const f = fs.flowByName("block.web.finder.search")!;
  assert.deepEqual(f.permissions, {}, "granted: nothing — the user grants it");
  assert.equal(w.getPage(w.getPage(f.pageId)!.parentId!)!.title, "Blocks");
  // A template calling a flow it hasn't got: said.
  assert.match(text(await call("workspace_save_block", { name: "x.y", description: "", template: '<button run="@later" label="Go"/>' })), /hasn't got yet: @later/);

  const one = text(await call("workspace_blocks", { name: "web.finder" }));
  assert.match(one, /"template"/);
  assert.match(one, /run="@search"/);
  assert.match(text(await call("workspace_block_docs", {})), /<use block="crm\.card"/);
  assert.match(text(await call("workspace_view_template_docs", {})), /BLOCKS of your own[\s\S]*crm\.card/);

  // A view's template is drawn on the rows before it is kept: a block it hasn't, a parameter it doesn't take — refused.
  const wrong = await call("workspace_update_database", { database: db, operations: [{ op: "add_view", name: "Cards", template: '<list source="rows"><use block="crm.card" colour="red"/></list>' }] });
  assert.equal(wrong.isError, true);
  assert.match(text(wrong), /no parameter “colour”/);
  const right = await call("workspace_update_database", { database: db, operations: [{ op: "add_view", name: "Cards", template: '<list source="rows"><use block="crm.card"/></list>' }] });
  assert.ok(!right.isError, text(right));

  // Removed with its flows.
  assert.match(text(await call("workspace_delete_block", { name: "web.finder", flows: true })), /Removed/);
  assert.equal(fs.flowByName("block.web.finder.search"), null);
});
