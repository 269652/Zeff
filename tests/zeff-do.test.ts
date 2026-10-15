import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const ctx = { ticket: "PROJ-306" };

/** "Do in Zeff": the AI proposes an offered API method from a colleague's words; it is checked, and one click runs it. */
test("zeff-do: an instruction becomes an action that adjusts the AI step's instructions on a click", async () => {
  const { cleanActions } = await import("@/plugins/actions/catalog");
  const { setInstalled } = await import("@/plugins/state");
  const { getContextPrefs, setStepPrefs } = await import("@/lib/boards/context-prefs");
  const { offerContext } = await import("@/plugins/actions/server");
  const { runZeffDo } = await import("@/plugins/actions/zeff-run");
  setInstalled("llm", true);

  // What exists now is what the AI is given to adjust.
  setStepPrefs("branchname", { extra: "Immer feature/ vor den Ticket-Key." });
  const known = (await offerContext({ ticket: "PROJ-306", text: "Christopher: Branch-Namen bitte nach dem Code Change benennen" })).join("\n");
  assert.match(known, /Schritt „branchname“/);
  assert.match(known, /Immer feature\/ vor den Ticket-Key\./, "the current instructions are in front of the AI");

  // The AI's proposal: complete, for a step that exists.
  const ops = cleanActions(
    [
      { type: "zeff-do", method: "llm.steps.update", args: JSON.stringify({ step: "branchname", extra: "Immer feature/ vor den Ticket-Key. Name nach dem Code Change, nicht nach dem Ticket-Titel.", numbers: '{"words": 4}' }) },
      { type: "zeff-do", method: "llm.steps.update", args: { step: "nope", extra: "x" } }, // no such step
      { type: "zeff-do", method: "llm.steps.update", args: {} }, // nothing to change
      { type: "zeff-do", method: "no.such.method", args: { a: "b" } }, // not offered
      { type: "zeff-do", args: "{}" }, // no method
    ],
    ctx,
  );
  assert.equal(ops.length, 1, "only the complete proposal for an offered method stays");
  const op = ops[0] as Extract<(typeof ops)[number], { type: "zeff-do" }>;
  assert.match(op.title, /Branch|branch/);
  assert.match(op.body, /nicht nach dem Ticket-Titel/);

  // The click: the method runs, the instructions are the adjusted ones.
  const done: string[] = [];
  const r = await runZeffDo(op, { todo: {} as never, note: (l) => done.push(l) });
  assert.ok(r.what.length > 0 && done.length === 1);
  const now = getContextPrefs().branchname;
  assert.match(now.extra, /nicht nach dem Ticket-Titel/);
  assert.equal(now.numbers.words, 4);

  // A numbers-only change keeps the words.
  const ops2 = cleanActions([{ type: "zeff-do", method: "llm.steps.update", args: { step: "branchname", numbers: '{"maxChars": 99}' } }], ctx);
  assert.equal(ops2.length, 1);
  await runZeffDo(ops2[0] as never, { todo: {} as never, note: () => undefined });
  assert.match(getContextPrefs().branchname.extra, /nicht nach dem Ticket-Titel/, "the instructions stay");
  assert.equal(getContextPrefs().branchname.numbers.maxChars, 60, "the number is held to the step's limits");
});

/** The AI's dictionary lists what is offered, and a plugin's offer is gone with the plugin. */
test("zeff-do: the dictionary lists the offered methods; an uninstalled plugin's are not offered", async () => {
  const { opsDictionary } = await import("@/lib/boards/shared");
  const { cleanActions } = await import("@/plugins/actions/catalog");
  const { setInstalled } = await import("@/plugins/state");
  setInstalled("kanban", true);
  setInstalled("llm", true);
  const dict = opsDictionary();
  assert.match(dict, /zeff-do/);
  assert.match(dict, /method „llm\.steps\.update“/);
  assert.match(dict, /method „kanban\.cards\.add“/);

  const store = await import("@/plugins/kanban/store");
  const board = store.createBoard({ name: "Privat" });
  const card = { type: "zeff-do", method: "kanban.cards.add", args: { board: "priv", column: "in prog", title: "Geschenk besorgen", description: "bis Freitag" } };
  const ops = cleanActions([card], ctx);
  assert.equal(ops.length, 1);
  assert.match((ops[0] as { title: string }).title, /Geschenk besorgen.*Privat/);
  const { runZeffDo } = await import("@/plugins/actions/zeff-run");
  await runZeffDo(ops[0] as never, { todo: {} as never, note: () => undefined });
  const cols = store.getBoard(board).columns;
  assert.deepEqual(cols.find((c) => c.name === "In progress")?.cards.map((c) => c.title), ["Geschenk besorgen"], "the column was found by its name");

  setInstalled("kanban", false);
  assert.ok(!/method „kanban\.cards\.add“/.test(opsDictionary()), "gone from the dictionary");
  assert.equal(cleanActions([card], ctx).length, 0, "and not proposed any more");
  await assert.rejects(runZeffDo(ops[0] as never, { todo: {} as never, note: () => undefined }), /not offered/);
});
