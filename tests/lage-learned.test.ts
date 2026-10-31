import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

// The briefing learns from your decisions across tickets: a kind you mostly drop goes into its prompt with examples — only
// your own decisions count, and only with enough of them.
setupTempData();

test("a kind you mostly dropped (enough decided): in the prompt with its examples — one you mostly ticked off, or a rule's decisions, not", async () => {
  const store = await import("@/lib/todos/store");
  const { attributed } = await import("@/lib/todos/activity");
  const { lageLearnedBlock, lageVerdicts } = await import("@/lib/learning/lage-learned");
  const { getDb, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const make = (kind: string, text: string) => {
    const t = store.addManualTodo({ ticket: "PROJ-1", text });
    getDb().update(schema.todos).set({ kind }).where(eq(schema.todos.id, t.id)).run();
    return t.id;
  };
  assert.deepEqual(lageLearnedBlock(), [], "nothing decided yet");
  for (let i = 0; i < 4; i++) attributed("you", () => store.setTodoStatus(make("clarify", `Christopher fragen ${i}`), "dismissed"));
  for (let i = 0; i < 2; i++) attributed("you", () => store.setTodoStatus(make("clarify", `Jenny fragen ${i}`), "done"));
  for (let i = 0; i < 5; i++) attributed("you", () => store.setTodoStatus(make("fix", `Bug ${i} fixen`), "done"));
  attributed("you", () => store.setTodoStatus(make("fix", "Bug x fixen"), "dismissed"));
  // A rule's decisions aren't yours.
  for (let i = 0; i < 6; i++) attributed("rule:replied", () => store.setTodoStatus(make("reply", `Antworten ${i}`), "done"));

  const v = lageVerdicts();
  assert.deepEqual(v.find((x) => x.kind === "clarify") && { done: v.find((x) => x.kind === "clarify")!.done, dropped: v.find((x) => x.kind === "clarify")!.dropped }, { done: 2, dropped: 4 });
  assert.equal(v.find((x) => x.kind === "reply"), undefined);
  const block = lageLearnedBlock().join("\n");
  assert.match(block, /„clarify“: 4 von 6 verworfen — z\. B\. „Christopher fragen 3“/);
  assert.doesNotMatch(block, /„fix“/);
});
