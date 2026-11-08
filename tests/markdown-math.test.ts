import assert from "node:assert/strict";
import test from "node:test";
import { parseInline, parseMarkdown } from "../src/lib/markdown";

test("inline math: $…$ and \\(…\\) become math, the rest stays text", () => {
  assert.deepEqual(parseInline("Sei $v=(1,2)$ und \\(w = 2v\\)."), [
    { t: "text", v: "Sei " },
    { t: "math", v: "v=(1,2)", display: false },
    { t: "text", v: " und " },
    { t: "math", v: "w = 2v", display: false },
    { t: "text", v: "." },
  ]);
  assert.deepEqual(parseInline("$2\\cdot(1,2)=(2,4)$"), [{ t: "math", v: "2\\cdot(1,2)=(2,4)", display: false }], "a backslash inside math stays");
  assert.deepEqual(parseInline("Der $\\mathbb{R}^2$ (Ebene)"), [{ t: "text", v: "Der " }, { t: "math", v: "\\mathbb{R}^2", display: false }, { t: "text", v: " (Ebene)" }]);
});

test("money isn't math: $ followed by a space or a closing $ before a digit", () => {
  assert.deepEqual(parseInline("costs 5 $ and 10 $"), [{ t: "text", v: "costs 5 $ and 10 $" }]);
  assert.deepEqual(parseInline("from $5 to $10"), [{ t: "text", v: "from $5 to $10" }]);
});

test("code wins over math", () => {
  assert.deepEqual(parseInline("`$x$`"), [{ t: "code", v: "$x$" }]);
});

test("display math: $$…$$ and \\[…\\] blocks, also over several lines", () => {
  assert.deepEqual(parseMarkdown("Text\n\n$$\n\\int_a^b f\n$$\n\nmehr"), [
    { t: "p", c: [{ t: "text", v: "Text" }] },
    { t: "math", v: "\\int_a^b f" },
    { t: "p", c: [{ t: "text", v: "mehr" }] },
  ]);
  assert.deepEqual(parseMarkdown("\\[ \\kappa = 1/r \\]"), [{ t: "math", v: "\\kappa = 1/r" }]);
  assert.deepEqual(parseMarkdown("$$x^2$$"), [{ t: "math", v: "x^2" }]);
});
