import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

test("'My briefing' runs the briefing itself; the board-briefing button (it skips the briefing's tickets) is only on the Jira boards", async () => {
  const { lageBoard } = await import("@/plugins/jira-lage/board");
  const { getDb, schema } = await import("@/db");
  getDb().insert(schema.jiraBoards).values({ id: 77, name: "Some board", enabled: true } as never).run();

  const mine = await lageBoard("jira-lage");
  assert.ok(mine);
  assert.equal(mine.boardLage, undefined);
  assert.equal(mine.briefing?.running, false);

  const board = await lageBoard("jira-77");
  assert.ok(board);
  assert.ok(board.boardLage);
  assert.equal(board.briefing, undefined);
});
