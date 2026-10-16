import assert from "node:assert/strict";
import test from "node:test";

/** A gallery card of a database whose rows come from a source (news, mails …) shows its text folded: the first lines, "more" for the rest. */
test("foldedLines: what a collapsed card shows and whether there is more", async () => {
  const { foldedLines } = await import("@/plugins/workspace/card-fold");
  const text = (t: string) => ({ kind: "text" as const, text: t });
  assert.deepEqual(foldedLines([]), { shown: [], more: false });
  const short = foldedLines([text("Kurz.")]);
  assert.deepEqual(short.shown.map((l) => l.text), ["Kurz."]);
  assert.equal(short.more, false, "a short text has nothing to unfold");
  const long = foldedLines([text("a".repeat(400)), text("zweite Zeile")]);
  assert.equal(long.more, true);
  assert.ok(long.shown.map((l) => l.text).join("").length <= 200, "cut to a couple of lines' worth");
  assert.match(long.shown[0].text, /…$/, "cut text ends with an ellipsis");
  const many = foldedLines([text("eins"), text("zwei"), text("drei"), text("vier")]);
  assert.deepEqual(many.shown.map((l) => l.text), ["eins", "zwei"], "two lines");
  assert.equal(many.more, true);
  // a checklist is left whole (its boxes are ticked in place)
  const task = { kind: "task" as const, text: "x", checked: false, index: 0 };
  assert.deepEqual(foldedLines([task, task, task]), { shown: [task, task], more: true });
});
