import assert from "node:assert/strict";
import test from "node:test";
import { groupTodos } from "@/lib/todos/groups";

const day = (d: number) => {
  const x = new Date();
  x.setDate(x.getDate() + d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

test("todo groups: flagged first, then overdue, today, this week, later, without a date — set aside ones last; each keeps the order it came in; empty groups left out", () => {
  const todos = [
    { id: 1, due: day(10), flaggedAt: null, deferred: false },
    { id: 2, due: day(-3), flaggedAt: null, deferred: false },
    { id: 3, due: null, flaggedAt: null, deferred: false },
    { id: 4, due: day(0), flaggedAt: null, deferred: false },
    { id: 5, due: day(-1), flaggedAt: "2026-10-20", deferred: false },
    { id: 6, due: day(5), flaggedAt: null, deferred: false },
    { id: 7, due: day(-9), flaggedAt: null, deferred: false },
    { id: 8, due: day(-2), flaggedAt: null, deferred: true },
    { id: 9, due: day(1), flaggedAt: null, deferred: false },
  ];
  const groups = groupTodos(todos);
  assert.deepEqual(
    groups.map((g) => [g.key, g.items.map((x) => x.id)]),
    [
      ["important", [5]],
      ["overdue", [2, 7]],
      ["today", [4]],
      ["week", [6, 9]],
      ["later", [1]],
      ["none", [3]],
      ["deferred", [8]],
    ],
  );
  assert.deepEqual(groupTodos([{ id: 1, due: null, flaggedAt: null, deferred: false }]).map((g) => g.key), ["none"]);
  assert.deepEqual(groupTodos([]), []);
});
