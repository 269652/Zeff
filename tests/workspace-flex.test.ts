import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

/** Flex blocks: a row or a column of blocks — nested in each other — to lay a page (a row's detail view) out. */
test("flex blocks: row and column, nested; their attributes kept to what they can be", async () => {
  const { sanitizeDoc, docText } = await import("@/plugins/workspace/doc");
  const doc = sanitizeDoc({
    type: "doc",
    content: [
      { type: "flexBox", attrs: { dir: "row", gap: "lg", wrap: true, evil: "x" }, content: [{ type: "flexBox", attrs: { dir: "col" }, content: [p("A"), p("B")] }, p("C")] },
      { type: "flexBox", attrs: { dir: "sideways", gap: "huge" }, content: [p("D")] },
    ],
  });
  const [row, other] = doc.content as never[] as { type: string; attrs: Record<string, unknown>; content: { type: string; attrs?: Record<string, unknown>; content: unknown[] }[] }[];
  assert.deepEqual(row.attrs, { dir: "row", gap: "lg", wrap: true }, "only its attributes");
  assert.equal(row.content[0].type, "flexBox");
  assert.equal(row.content[0].attrs?.dir, "col", "nested");
  assert.equal(row.content[0].content.length, 2);
  assert.equal(other.attrs.dir, "row", "an unknown direction is a row");
  assert.equal(other.attrs.gap, "md", "an unknown gap is the middle one");
  assert.match(docText(doc as never), /A\s*B\s*C\s*D/, "the text inside is the page's text");
});

test("flex blocks: a page of blocks keeps them through markdown for the AI (the text stays, the layout is dropped)", async () => {
  const { docToMarkdown } = await import("@/plugins/workspace/doc");
  const md = docToMarkdown({ type: "doc", content: [{ type: "flexBox", attrs: { dir: "row" }, content: [p("Links"), p("Rechts")] }] } as never);
  assert.match(md, /Links/);
  assert.match(md, /Rechts/);
});

test("flex boxes: a box in a row can be wider — span 1 to 4", async () => {
  const { sanitizeDoc } = await import("@/plugins/workspace/doc");
  const doc = sanitizeDoc({ type: "doc", content: [{ type: "flexBox", attrs: { dir: "row" }, content: [{ type: "flexBox", attrs: { dir: "col", span: 2 }, content: [p("A")] }, { type: "flexBox", attrs: { dir: "col", span: 9 }, content: [p("B")] }, { type: "flexBox", attrs: { dir: "col", span: "x" }, content: [p("C")] }] }] });
  const cols = (doc.content![0] as { content: { attrs: Record<string, unknown> }[] }).content;
  assert.equal(cols[0].attrs.span, 2);
  assert.equal(cols[1].attrs.span, 4, "at most 4");
  assert.equal(cols[2].attrs.span, undefined, "not a number: the default");
});
