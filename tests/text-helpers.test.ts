import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml } from "@/lib/html-text";
import { escapeRegExp, flatSlice, flatTruncate, flatten, trimSlice } from "@/lib/text";

test("flatten, flatSlice, flatTruncate, trimSlice: what the private clips did", () => {
  assert.equal(flatten("  a\n\tb  "), "a b");
  assert.equal(flatten(null), "");
  assert.equal(flatSlice(" one  two three ", 7), "one two");
  assert.equal(flatTruncate("one  two three", 8), "one two…");
  assert.equal(flatTruncate("short", 8), "short");
  assert.equal(trimSlice("  a\n b  ", 10), "a\n b");
  assert.equal(trimSlice(undefined, 3), "");
});

test("escapeRegExp matches the text as it is; escapeHtml makes it safe in HTML", () => {
  assert.ok(new RegExp(`^${escapeRegExp("a.b*(c)[d]\\e")}$`).test("a.b*(c)[d]\\e"));
  assert.equal(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`), "&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;");
  assert.equal(escapeHtml(null), "");
});
