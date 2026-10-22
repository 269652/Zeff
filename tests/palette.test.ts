import assert from "node:assert/strict";
import test from "node:test";
import { filterPalette, opensCommands, opensPalette, opensShortcuts, parseCommand, type PaletteItem } from "../src/lib/palette";

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
test("Ctrl/Cmd+Shift+K opens the commands, not the pages — in a field too", () => {
  const k = (key: string, target: { tagName?: string } | null, extra = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target, ...extra });
  assert.ok(opensCommands(k("K", { tagName: "INPUT" }, { ctrlKey: true, shiftKey: true })));
  assert.ok(opensCommands(k("k", null, { metaKey: true, shiftKey: true })));
  assert.ok(!opensPalette(k("K", null, { ctrlKey: true, shiftKey: true })), "not both at once");
  assert.ok(opensPalette(k("k", null, { ctrlKey: true })));
  assert.ok(!opensCommands(k("k", null, { ctrlKey: true })));
  assert.ok(!opensCommands(k("K", null, { ctrlKey: true, shiftKey: true, altKey: true })));
});
test("a command's href: what and its argument", () => {
  assert.deepEqual(parseCommand("zeff:sync:jira"), { what: "sync", arg: "jira" });
  assert.deepEqual(parseCommand("zeff:new-page"), { what: "new-page", arg: "" });
  assert.deepEqual(parseCommand("zeff:sync:google-drive:x"), { what: "sync", arg: "google-drive:x" });
  assert.equal(parseCommand("/workspace/3"), null);
});
