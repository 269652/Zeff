import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ROOT, setupTempData } from "./helpers";

/**
 * Writable data sources, by Zeff's actions: a source can be written to where an installed action writes to its channel —
 * mail (Outlook, Gmail) as a draft that opens for you to send, Teams / WhatsApp / Signal sent. A row's action runs from the
 * row (no todo needed): a draft's address back, a message sent; a reply drafted by the AI from the conversation.
 */
const dir = setupTempData();
process.env.CLAUDE_CLI = path.join(ROOT, "tests", "fake-claude-json.mjs");
const promptFile = path.join(dir, "prompt.txt");
process.env.FAKE_CLAUDE_PROMPT_FILE = promptFile;
const ago = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();

test("writable sources: what can be written where (by the actions installed); a row's action — a draft's address, not a todo's action", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const id of ["workspace", "outlook-mail", "gmail", "teams", "llm", "claude-cli"]) setInstalled(id, true);
  setInstalled("whatsapp", false);
  setInstalled("signal", false);
  const { updateAppSettings } = await import("@/lib/ai");
  updateAppSettings({ aiProvider: "claude" });
  const { saveMails } = await import("@/lib/mail/store");
  const w = await import("@/plugins/workspace/store");
  const { runPipeline } = await import("@/plugins/workspace/pipeline");
  const { createSourceDatabase } = await import("@/plugins/workspace/derived");
  const { capabilitiesOf } = await import("@/plugins/workspace/capabilities");
  const { runRowAction, draftRowReply } = await import("@/plugins/workspace/row-actions");
  saveMails([
    { convId: "AQ1", folder: "Posteingang", from: "Anna Berg", fromEmail: "anna@example.com", subject: "Termin?", preview: "Passt dir Freitag?", receivedAt: ago(1), unread: true },
  ]);
  const mail = createSourceDatabase("mail");
  await runPipeline(mail, { ai: false });
  const caps = capabilitiesOf(w.getDatabase(mail)!.schema);
  assert.deepEqual(caps.reply.sort(), ["Gmail", "Outlook"], "mail: a draft in Outlook, in Gmail");
  assert.equal(caps.readOnly, false);
  const msgs = createSourceDatabase("messages");
  assert.deepEqual(capabilitiesOf(w.getDatabase(msgs)!.schema).reply, ["Teams"], "messages: Teams (WhatsApp's, Signal's plugins off)");

  const row = w.rawRows(mail)[0];
  const r = await runRowAction(row.id, { type: "mail-compose", to: "anna@example.com", subject: "AW: Termin?", body: "Freitag passt." });
  assert.match(r.href ?? "", /outlook\.office\.com/, "a draft: its address, opened by you");
  await assert.rejects(runRowAction(row.id, { type: "whatsapp-message", chat: "Anna", body: "x" }), /not installed/i);
  await assert.rejects(runRowAction(row.id, { type: "calendar-entry", title: "x", start: "2026-10-20 10:00", minutes: 30, body: "" }), /todo/i, "what needs a todo: not from a row");

  process.env.FAKE_CLAUDE_OUTPUT = JSON.stringify({ text: "Hallo Anna, Freitag passt mir gut." });
  const d = await draftRowReply(row.id);
  assert.equal(d.text, "Hallo Anna, Freitag passt mir gut.");
  assert.equal(d.to, "anna@example.com");
  assert.equal(d.subject, "AW: Termin?");
  assert.match(fs.readFileSync(promptFile, "utf8"), /Passt dir Freitag\?/, "the conversation in the prompt");
});
