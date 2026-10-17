import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** "Make this an agent / a routine": a page gets its routine and the controls block at the top, its own text stays. */
test("a page made a routine: routine created, controls block first, text kept; twice changes nothing", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "work", "todos"]) setInstalled(id, true);
  const w = await import("@/plugins/workspace/store");
  const r = await import("@/plugins/workspace/routines");
  const { makeRoutinePage } = await import("@/plugins/workspace/routine-make");
  const id = w.createPage({ title: "Wochenbericht", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Fasse die Woche zusammen." }] }] } });
  makeRoutinePage(id, "agent");
  assert.equal(r.getRoutine(id)!.kind, "agent");
  assert.equal(r.getRoutine(id)!.enabled, false);
  const doc = w.getPage(id)!.content as { content: { type: string }[] };
  assert.equal(doc.content[0].type, "zeffRoutine");
  assert.equal(doc.content.filter((n) => n.type === "zeffRoutine").length, 1);
  assert.match(JSON.stringify(doc), /Fasse die Woche/);
  makeRoutinePage(id, "agent");
  assert.equal((w.getPage(id)!.content as { content: { type: string }[] }).content.filter((n) => n.type === "zeffRoutine").length, 1);
  assert.throws(() => makeRoutinePage(w.createPage({ kind: "database", title: "DB" }), "agent"), /database/i);
});

test("a routine page that lost its controls block gets it back", async () => {
  const w = await import("@/plugins/workspace/store");
  const r = await import("@/plugins/workspace/routines");
  const { makeRoutinePage } = await import("@/plugins/workspace/routine-make");
  const id = w.createPage({ title: "Ohne Block" });
  r.createRoutine(id, "automation");
  makeRoutinePage(id, "agent");
  assert.equal(r.getRoutine(id)!.kind, "automation", "an existing routine keeps its kind");
  assert.equal((w.getPage(id)!.content as { content: { type: string }[] }).content[0].type, "zeffRoutine");
});
