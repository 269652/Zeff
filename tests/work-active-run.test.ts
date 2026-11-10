import { test } from "node:test";
import assert from "node:assert/strict";
import { activeRunByTodo } from "@/lib/work/shared";

test("a worked-on todo links its running run before a queued one, then the newest", () => {
  const runs = [
    { id: 3, todoId: 1, status: "queued" as const },
    { id: 4, todoId: 1, status: "running" as const },
    { id: 7, todoId: 1, status: "queued" as const },
    { id: 5, todoId: 2, status: "queued" as const },
    { id: 9, todoId: 2, status: "queued" as const },
    { id: 6, todoId: 3, status: "running" as const },
    { id: 8, todoId: 3, status: "running" as const },
    { id: 10, todoId: 4, status: "done" as const },
  ];
  assert.deepEqual(activeRunByTodo(runs), { 1: 4, 2: 9, 3: 8 });
});

test("no runs: nothing being worked on", () => {
  assert.deepEqual(activeRunByTodo([]), {});
});
