import assert from "node:assert/strict";
import test from "node:test";
import { fitAiContent, relocate } from "@/plugins/workspace/ai-fit";

const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

test("the AI's text in a line: one paragraph goes in as its text (no new line), more blocks stay blocks", () => {
  assert.deepEqual(fitAiContent([para("Hallo Welt")], true), [{ type: "text", text: "Hallo Welt" }], "within one line: inline");
  assert.deepEqual(fitAiContent([para("a"), para("b")], true), [para("a"), para("b")], "two paragraphs: blocks");
  assert.deepEqual(fitAiContent([para("Hallo")], false), [para("Hallo")], "the selection over several lines: blocks");
  assert.deepEqual(fitAiContent([{ type: "bulletList" }], true), [{ type: "bulletList" }]);
});

test("the selection found again: where it was while it still says the same, else where it is now in a line — gone: nothing", () => {
  // A tiny page: two lines, positions as the editor counts them (a line's text starts after its opening).
  const blocks = [
    { start: 1, text: "Erste Zeile hier." },
    { start: 20, text: "Zweite Zeile, die übersetzt wird." },
  ];
  const textAt = (from: number, to: number) => {
    const b = blocks.find((x) => from >= x.start && to <= x.start + x.text.length);
    if (!b) throw new Error("out of range");
    return b.text.slice(from - b.start, to - b.start);
  };
  assert.deepEqual(relocate("Zeile, die", { from: 27, to: 37 }, textAt, blocks), { from: 27, to: 37 }, "unchanged: the same range");
  assert.deepEqual(relocate("Zeile, die", { from: 3, to: 13 }, textAt, blocks), { from: 27, to: 37 }, "moved: found again");
  assert.equal(relocate("nicht mehr da", { from: 3, to: 13 }, textAt, blocks), null);
});
