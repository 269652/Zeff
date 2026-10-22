import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { draw } from "../src/plugins/workspace/ui/card-template";
import type { VNode } from "../src/plugins/workspace/card-template";

/**
 * Any element of a template can say what a phone does with it: phone="hide" — not on a phone (a second "new" button, a sync
 * button the header has), phone="only" — only there. Wrapped in a box that takes no room of its own (display: contents).
 */
const row = (a: Record<string, string>): VNode => ({ t: "row", a, c: ["x"] });
const html = (n: VNode) => renderToStaticMarkup(draw(n, 0) as never);

test('phone="hide": hidden below the phone breakpoint, there on a wide screen', () => {
  const h = html(row({ phone: "hide" }));
  assert.match(h, /^<div class="contents max-sm:hidden">/);
  assert.match(h, />x</);
});

test('phone="only": only on a phone', () => {
  assert.match(html(row({ phone: "only" })), /^<div class="contents sm:hidden">/);
});

test("without it: as before, no wrapper", () => {
  assert.doesNotMatch(html(row({})), /contents/);
});
