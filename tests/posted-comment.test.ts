import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("a Jira comment Zeff posted points back to the todo whose action wrote it — found by the todo's done event, a moment after the comment", async () => {
  const { getSqlite } = await import("@/db");
  const { postedFrom } = await import("@/lib/boards/sources");
  const db = getSqlite();
  const insert = db.prepare("insert into todo_events (todo_id, event, ticket, text, note, at) values (?, 'done', ?, ?, ?, ?)");
  insert.run(129, "PROJ-364", "Rico/Jens im Ticket bestätigen", "Comment posted on PROJ-364", "2026-10-12T15:46:48.742Z");
  insert.run(130, "PROJ-364", "Etwas anderes", "Ticket moved to Done", "2026-10-12T15:46:49.000Z");
  assert.deepEqual(postedFrom("PROJ-364", "2026-10-12T15:46:47.682Z"), { todoId: 129, text: "Rico/Jens im Ticket bestätigen" });
  assert.equal(postedFrom("PROJ-364", "2026-10-12T11:53:55.014Z"), undefined, "a comment from long before: nobody's action");
  assert.equal(postedFrom("PROJ-999", "2026-10-12T15:46:47.682Z"), undefined, "another ticket");
});
