import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_LOOK, LOOK_IDS, parseLook } from "../src/lib/badges/look";
import { BADGE_COLORS, BADGE_DOTS, BADGE_DOTS_SOFT, BADGE_MARKS, BADGE_TONES, BADGE_TONES_DIM, parseColor } from "../src/lib/badges/palette";
import { DEFAULT_WS_BADGES, keepParts, parseWsBadges, rowPartSource, WS_SOURCES, WS_TONES } from "../src/plugins/workspace/badge-config";
import { badgeOf, shownBadge, type BadgePart } from "../src/plugins/workspace/badge-shared";

test("palette: every colour has a pill, a pale pill, a dot and a mark — whole class names", () => {
  for (const map of [BADGE_TONES, BADGE_TONES_DIM, BADGE_DOTS, BADGE_DOTS_SOFT, BADGE_MARKS]) {
    assert.deepEqual(Object.keys(map).sort(), [...BADGE_COLORS].sort());
    for (const c of BADGE_COLORS) assert.match(map[c], new RegExp(`-${c}-\\d`));
  }
  assert.equal(parseColor("teal", "red"), "teal");
  assert.equal(parseColor("neon", "red"), "red");
  assert.equal(parseColor(3, "sky"), "sky");
});

test("workspace badges: junk and missing values fall back to the default, unknown keys dropped", () => {
  for (const junk of [null, undefined, 3, "x", [], { tones: [], sources: "no" }]) assert.deepEqual(parseWsBadges(junk), DEFAULT_WS_BADGES);
  const c = parseWsBadges({ tones: { unread: { on: false, color: "rose" }, important: { color: "neon" }, nope: { on: false } }, sources: { widgets: false, activity: "off", other: false } });
  assert.deepEqual(c.tones.unread, { on: false, color: "rose" });
  assert.deepEqual(c.tones.important, { on: true, color: "red" });
  assert.equal(c.sources.widgets, false);
  assert.equal(c.sources.activity, true);
  assert.deepEqual(Object.keys(c.tones), [...WS_TONES]);
  assert.deepEqual(Object.keys(c.sources), [...WS_SOURCES]);
  // The default is today's look.
  assert.deepEqual(
    Object.fromEntries(WS_TONES.map((id) => [id, DEFAULT_WS_BADGES.tones[id].color])),
    { unread: "indigo", important: "red", activity: "indigo", messages: "teal", todos: "indigo" },
  );
  assert.ok(WS_SOURCES.every((id) => DEFAULT_WS_BADGES.sources[id]));
});

test("workspace badges: the default lets every part through unchanged", () => {
  const parts: BadgePart[] = [
    { tone: "unread", count: 2, label: "a" },
    { tone: "important", count: 1, label: "b" },
    { tone: "activity", count: 3, label: "c" },
    { tone: "messages", count: 4, label: "d" },
    { tone: "important", count: 1, label: "e", todo: true },
  ];
  assert.deepEqual(keepParts(parts, "widgets", DEFAULT_WS_BADGES), parts);
  assert.deepEqual(keepParts(null, "widgets", DEFAULT_WS_BADGES), []);
});

test("workspace badges: a source switched off counts nothing", () => {
  const off = parseWsBadges({ sources: { unread: false } });
  assert.deepEqual(keepParts([{ tone: "unread", count: 12, label: "12 unread" }], "unread", off), []);
  assert.equal(keepParts([{ tone: "unread", count: 2, label: "x" }], "widgets", off).length, 1);
  assert.equal(badgeOf(keepParts([{ tone: "unread", count: 12, label: "12 unread" }], "unread", off)), null);
});

test("workspace badges: a kind switched off is left out; late todos stay open todos without important", () => {
  const cfg = parseWsBadges({ tones: { important: { on: false }, messages: { on: false } } });
  const parts: BadgePart[] = [
    { tone: "unread", count: 2, label: "open", todo: true },
    { tone: "important", count: 1, label: "late", todo: true },
    { tone: "important", count: 1, label: "promise" },
    { tone: "messages", count: 3, label: "msgs" },
    { tone: "unread", count: 5, label: "unread" },
  ];
  const kept = keepParts(parts, "rowTodos", cfg);
  assert.deepEqual(kept.map((p) => p.label), ["open", "late", "unread"]);
  const b = badgeOf(kept)!;
  assert.equal(b.todos, 3);
  assert.equal(b.todosLate, 0);
  assert.equal(b.important, 0);
  assert.equal(b.messages, 0);
  assert.deepEqual(shownBadge(b), { tone: "unread", count: 5 });
  // Todos off: gone, whatever their tone.
  const noTodos = parseWsBadges({ tones: { todos: { on: false } } });
  assert.deepEqual(keepParts(parts.slice(0, 2), "rowTodos", noTodos), []);
});

test("workspace badges: a row source's parts are told apart", () => {
  assert.equal(rowPartSource({ tone: "important", count: 1, label: "", todo: true }), "rowTodos");
  assert.equal(rowPartSource({ tone: "messages", count: 1, label: "" }), "rowMessages");
  assert.equal(rowPartSource({ tone: "important", count: 1, label: "" }), "rowOther");
  const cfg = parseWsBadges({ sources: { rowMessages: false } });
  const parts: BadgePart[] = [
    { tone: "unread", count: 1, label: "todo", todo: true },
    { tone: "messages", count: 2, label: "msgs" },
    { tone: "important", count: 1, label: "promise" },
  ];
  assert.deepEqual(parts.flatMap((p) => keepParts([p], rowPartSource(p), cfg)).map((p) => p.label), ["todo", "promise"]);
});

test("marks' look: junk falls back to the default, missing marks added", () => {
  for (const junk of [null, 1, "x", [], { waiting: "on" }]) assert.deepEqual(parseLook(junk), DEFAULT_LOOK);
  const l = parseLook({ waiting: { on: false, color: "violet" }, syncFailed: { color: "neon" }, extra: { on: false } });
  assert.deepEqual(l.waiting, { on: false, color: "violet" });
  assert.deepEqual(l.syncFailed, { on: true, color: "red" });
  assert.deepEqual(Object.keys(l), [...LOOK_IDS]);
  assert.deepEqual(DEFAULT_LOOK, { todoActivity: { on: true, color: "sky" }, waiting: { on: true, color: "amber" }, menu: { on: true, color: "indigo" }, syncFailed: { on: true, color: "red" }, syncUnwell: { on: true, color: "amber" } });
});
