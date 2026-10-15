import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ROOT, setupTempData } from "./helpers";

// The Board-Lage as a review step of every board: the open, recently moved cards of the board databases (your own,
// and the Jira boards the sync keeps) get their Lage — Jira's read from Jira, your own from their rows.
const dir = setupTempData();
process.env.CLAUDE_CLI = path.join(ROOT, "tests", "fake-claude-json.mjs");
const promptFile = path.join(dir, "prompt.txt");
process.env.FAKE_CLAUDE_PROMPT_FILE = promptFile;
delete process.env.JIRA_URL;

test("board review: your own board's open cards get their Lage — without Jira, without being in the briefing", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["llm", "claude-cli", "kanban", "workspace", "jira-lage", "todos"]) setInstalled(id, true);
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ aiProvider: "claude" });
  const s = await import("@/plugins/kanban/store");
  const w = await import("@/plugins/workspace/store");
  const { moveBoardToWorkspace, movedCard } = await import("@/plugins/kanban/to-workspace");
  const { setCollection } = await import("@/lib/items");
  const { runBoardLage } = await import("@/plugins/jira-lage/board-lage");

  const b = s.createBoard({ name: "Privat", columns: ["Offen", "Dran", "Fertig"] });
  const [open, , done] = s.getBoard(b).columns;
  s.updateColumn(done.id, { done: true });
  const card = s.createCard(open.id, "Steuer machen");
  s.updateCard(card.id, { description: "Belege fehlen noch" });
  const fin = s.createCard(open.id, "Erledigt");
  s.moveCard(fin.id, done.id, null);
  const { dbId } = moveBoardToWorkspace(b);
  setCollection(`workspace:${dbId}`, { briefing: false });
  const fresh = w.addRow(dbId, { title: "Neue Idee" });
  const key = `KB-${card.id}`;

  const { LAGE_FIELDS } = await import("@/plugins/workspace/lage-fields");
  const a = await import("@/plugins/workspace/actions");
  const row = movedCard(card.id)!;
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({
    rows: [
      { id: row, values: { [LAGE_FIELDS.attention]: "blocked", [LAGE_FIELDS.lead]: "Wartet auf die Belege.", [LAGE_FIELDS.summary]: "Belege fehlen." } },
      { id: fresh, values: { [LAGE_FIELDS.attention]: "ready", [LAGE_FIELDS.lead]: "Kann losgehen.", [LAGE_FIELDS.summary]: "Neu." } },
    ],
  });
  const r = await runBoardLage();
  assert.equal(r.ok, true, r.error);
  assert.equal(r.analyzed, 2, "the two open cards");
  const prompt = fs.readFileSync(promptFile, "utf8");
  assert.match(prompt, /Steuer machen/);
  assert.match(prompt, /Belege fehlen noch/);
  assert.match(prompt, /„Attention“/, "the review's own fields");

  const cards = async () => {
    const l = await a.loadDatabaseAction(dbId);
    assert.ok(l.ok);
    return l.data.extras.tickets;
  };
  assert.equal((await cards())[key]?.attention, "blocked");
  assert.equal((await cards())[key]?.lead, "Wartet auf die Belege.");
  assert.equal((await cards())[`WS-${fresh}`]?.attention, "ready");

  fs.rmSync(promptFile);
  const again = await runBoardLage();
  assert.equal(again.analyzed, 0, "unchanged: not again");
  w.updatePage(row, { title: "Steuer machen (Belege da)" });
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ rows: [{ id: row, values: { [LAGE_FIELDS.attention]: "active", [LAGE_FIELDS.lead]: "Läuft.", [LAGE_FIELDS.summary]: "" } }] });
  const changed = await runBoardLage();
  assert.equal(changed.analyzed, 1, "changed: read again");
  assert.equal((await cards())[key]?.attention, "active");
});
