import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/**
 * What left this PC, provably (lib/ai/receipts.ts): every text an AI step sent — which step, to which AI, how much, how many
 * secret lines were left out of it — kept here, to look at and to export; nothing kept longer than 30 days.
 */
test("a prompt sent is a receipt: the step, the AI, the text as it went, the secret lines left out", async () => {
  const r = await import("@/lib/ai/receipts");
  r.recordReceipt({ task: "mail-review", provider: "claude", model: "sonnet", text: "Mail von Anna: Termin?\n[…]\nMail von Ben", redacted: 1 });
  r.recordReceipt({ task: "briefing", provider: "codex", model: null, text: "Ticket ABC-1", redacted: 0 });
  const list = r.listReceipts({ days: 30 });
  assert.deepEqual(list.map((x) => [x.task, x.provider, x.redacted]), [["briefing", "codex", 0], ["mail-review", "claude", 1]], "newest first");
  assert.equal(list[1].chars, "Mail von Anna: Termin?\n[…]\nMail von Ben".length);
  assert.equal(r.receiptText(list[1].id), "Mail von Anna: Termin?\n[…]\nMail von Ben", "the text as it went");
  const month = new Date().toISOString().slice(0, 7);
  const md = r.exportReceipts(month);
  assert.match(md, /mail-review/);
  assert.match(md, /Ticket ABC-1/, "the export holds what went");
});

test("old receipts go: kept 30 days", async () => {
  const r = await import("@/lib/ai/receipts");
  const { getSqlite } = await import("@/db");
  r.recordReceipt({ task: "old", provider: "claude", model: null, text: "x", redacted: 0 });
  getSqlite().prepare("update ai_receipts set at = ? where task = 'old'").run(new Date(Date.now() - 40 * 864e5).toISOString());
  r.pruneReceipts();
  assert.equal(r.listReceipts({ days: 365 }).some((x) => x.task === "old"), false);
});

test("the redactions in a guarded prompt are counted", async () => {
  const { countRedactions } = await import("@/lib/ai/receipts");
  const { REDACTED } = await import("@/lib/boundaries/shared");
  assert.equal(countRedactions("a\nb", `a\n${REDACTED}`), 1);
  assert.equal(countRedactions("a", "a"), 0);
});

test("an AI step through llm(): a receipt of exactly what went to the AI (a fake Claude here)", async () => {
  const path = await import("node:path");
  const { ROOT } = await import("./helpers");
  process.env.CLAUDE_CLI = path.join(ROOT, "tests", "fake-claude-json.mjs");
  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ ok: true });
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["llm", "claude-cli"]) setInstalled(id, true);
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ aiProvider: "claude" });
  const { llm } = await import("@/plugins/llm/run");
  await llm("briefing" as never, "Bitte fasse zusammen: Hallo Welt", { type: "object" }, { fresh: true });
  const r = await import("@/lib/ai/receipts");
  const last = r.listReceipts({ limit: 1 })[0];
  assert.equal(last.provider, "claude");
  assert.match(r.receiptText(last.id) ?? "", /Hallo Welt/, "what went, as it went");
});
