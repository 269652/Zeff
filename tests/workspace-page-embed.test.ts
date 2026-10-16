import assert from "node:assert/strict";
import test from "node:test";

/** A page shown in another page (an inline page): a block of the document — kept, as Markdown, not as the page's text. */
test("pageEmbed: a block kept by sanitize, as Markdown and back, not in the text", async () => {
  const d = await import("@/plugins/workspace/doc");
  const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Vorher" }] }, { type: "pageEmbed", attrs: { pageId: 12, title: "Ideen", junk: 1 } }] };
  const clean = d.sanitizeDoc(doc) as { content: { type: string; attrs?: Record<string, unknown> }[] };
  assert.deepEqual(clean.content[1], { type: "pageEmbed", attrs: { pageId: 12, title: "Ideen" } });
  const md = d.docToMarkdown(clean as never);
  assert.match(md, /^:::page 12 Ideen$/m);
  const back = d.markdownToDoc(md).content as { type: string; attrs?: Record<string, unknown> }[];
  assert.deepEqual(back.find((n) => n.type === "pageEmbed")?.attrs, { pageId: 12, title: "Ideen" });
  assert.doesNotMatch(d.docText(clean as never), /Ideen/, "the other page's text isn't this page's");
});
