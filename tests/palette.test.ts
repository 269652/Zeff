import assert from "node:assert/strict";
import test from "node:test";
import { filterPalette, opensPalette, opensShortcuts, type PaletteItem } from "../src/lib/palette";

const items: PaletteItem[] = [
  { id: "a", label: "Connections", hint: "Chrome or API, per service", href: "/connections", group: "Pages" },
  { id: "b", label: "Browser sign-ins", hint: "Logins in the automation Chrome", href: "/logins", group: "Pages" },
  { id: "c", label: "Settings hub", href: "/settings/all", group: "Pages", keywords: "preferences" },
];

test("label prefix beats hint match", () => {
  assert.deepEqual(filterPalette(items, "chrome").map((i) => i.id), ["a", "b"]);
  assert.equal(filterPalette(items, "conn")[0].id, "a");
});
test("every word must match; keywords count", () => {
  assert.deepEqual(filterPalette(items, "sign browser").map((i) => i.id), ["b"]);
  assert.deepEqual(filterPalette(items, "preferences").map((i) => i.id), ["c"]);
  assert.deepEqual(filterPalette(items, "zzz"), []);
});
test("empty query lists the first items", () => {
  assert.equal(filterPalette(items, "  ", 2).length, 2);
});
test("shortcut keys", () => {
  const k = (key: string, target: { tagName?: string } | null, extra = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, target, ...extra });
  assert.ok(opensPalette(k("k", { tagName: "INPUT" }, { ctrlKey: true })));
  assert.ok(opensPalette(k("/", { tagName: "DIV" })));
  assert.ok(!opensPalette(k("/", { tagName: "TEXTAREA" })));
  assert.ok(opensShortcuts(k("?", null)));
  assert.ok(!opensShortcuts(k("?", { tagName: "INPUT" })));
});
