import assert from "node:assert/strict";
import test from "node:test";
import { markdownEditable, markdownToDoc } from "../src/plugins/workspace/doc";

test("a page made of what Markdown keeps can be edited as Markdown (offline on the phone); one with richer blocks can't", () => {
  assert.equal(markdownEditable(markdownToDoc("# Plan\n\nText **fett** [link](https://x.y)\n\n- [ ] a\n- b\n\n| a | b |\n|---|---|\n| 1 | 2 |")), true);
  assert.equal(markdownEditable({ type: "doc", content: [{ type: "paragraph" }] }), true, "an empty page");
  assert.equal(markdownEditable(null), true, "no body yet");
  const callout = { type: "doc", content: [{ type: "callout", content: [{ type: "paragraph", content: [{ type: "text", text: "Achtung" }] }] }] };
  assert.equal(markdownEditable(callout), false, "a callout would be lost");
  const db = { type: "doc", content: [{ type: "databaseView", attrs: { id: 3 } }] };
  assert.equal(markdownEditable(db), false, "an embedded database");
  const colour = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "rot", marks: [{ type: "textStyle", attrs: { color: "red" } }] }] }] };
  assert.equal(markdownEditable(colour), false, "a colour mark");
  const mention = { type: "doc", content: [{ type: "paragraph", content: [{ type: "mention", attrs: { id: "p:1" } }] }] };
  assert.equal(markdownEditable(mention), false, "a mention");
});
