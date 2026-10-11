import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** Signal's chats are kept like WhatsApp's: in their own folder, waiting for you, chats (not mails) for the review. */
test("a Signal chat waits for you — a group only when something is to you", async () => {
  const { getDb, schema } = await import("@/db");
  const { chatsWaiting, saveMails, whatsappChatsWaiting } = await import("@/lib/mail/store");
  const now = Date.parse("2026-10-10T12:00:00Z");
  const at = (h: number) => new Date(now - h * 3600e3).toISOString();
  const msg = (id: string, chat: string, from: string, text: string, h: number, flags: { group?: boolean; toMe?: boolean } = {}) => ({
    id,
    convId: `sg:${chat}`,
    folder: "Signal",
    from,
    fromEmail: null,
    subject: chat,
    preview: text,
    receivedAt: at(h),
    unread: from !== "Ich",
    group: flags.group ?? false,
    toMe: flags.toMe ?? false,
  });
  const r = saveMails([
    msg("a1", "Anna", "Ich", "Treffen wir uns Samstag?", 30),
    msg("a2", "Anna", "Anna", "Ja! Wann?", 20),
    msg("b1", "Ben", "Ben", "Danke dir", 10),
    msg("b2", "Ben", "Ich", "Gerne", 9),
    msg("v1", "Verein", "Tom", "Wer kommt Sonntag?", 5, { group: true }),
    msg("v2", "Verein", "Lisa", "@Moritz bringst du den Schlüssel?", 4, { group: true, toMe: true }),
  ]);
  assert.equal(r.added, 6);
  // Read again (the next sync): each once, by Signal's id.
  assert.equal(saveMails([msg("a2", "Anna", "Anna", "Ja! Wann?", 20)]).added, 0);

  const w = chatsWaiting("Signal", 7, now);
  assert.deepEqual(
    w.map((c) => c.who),
    ["Verein", "Anna"],
  );
  assert.equal(w[0].text, "Lisa: @Moritz bringst du den Schlüssel?");
  assert.equal(w[0].count, 1, "only what's to you counts in a group");
  // Signal's chats aren't WhatsApp's.
  assert.deepEqual(whatsappChatsWaiting(7, now), []);
  const rows = getDb().select().from(schema.emails).all();
  assert.ok(rows.every((m) => m.folder === "Signal" && m.convId.startsWith("sg:")));
});

test("Signal's messages are chats: never filtered out of the review, never must-do mails", async () => {
  const { notForReview, mustDo } = await import("@/lib/boards/mail-todos");
  const { isChatFolder, sourceOn } = await import("@/lib/mail/shared");
  const m = { fromName: "Anna", fromEmail: null, subject: "Anna", preview: "Pflichtschulung: Erinnerung, bis morgen erledigen?", folder: "Signal" };
  assert.ok(isChatFolder("Signal") && isChatFolder("WhatsApp") && !isChatFolder("Posteingang"));
  assert.ok(!notForReview({ ...m, subject: "Abwesend" }, false));
  assert.ok(!mustDo(m));
  assert.equal(sourceOn({ mail: true, whatsapp: true, signal: false }, "Signal"), false);
  assert.equal(sourceOn({ mail: false, whatsapp: true, signal: true }, "Signal"), true);
});

test("a proposed Signal message is cleaned like WhatsApp's", async () => {
  const { cleanActions } = await import("@/plugins/actions/catalog");
  const ops = cleanActions(
    [
      { type: "signal-message", chat: " Anna ", body: " Samstag 15 Uhr? " },
      { type: "signal-message", chat: "", body: "kein Chat" },
    ],
    { ticket: "" },
  );
  assert.deepEqual(ops, [{ type: "signal-message", chat: "Anna", body: "Samstag 15 Uhr?" }]);
});

test("the mail review is told about Signal only when its messages are there", async () => {
  const { mailReviewPrompt } = await import("@/lib/boards/mail-todos");
  const mail = { key: "k", receivedAt: "2026-10-10T10:00:00Z", fromName: "Anna", fromEmail: null, subject: "Anna", preview: "Hallo" };
  const base = { tickets: [], open: [], verdicts: { dropped: [], done: [] } };
  assert.ok(!mailReviewPrompt({ ...base, mails: [{ ...mail, folder: "WhatsApp" }] }).includes("„Signal“"));
  assert.ok(mailReviewPrompt({ ...base, mails: [{ ...mail, folder: "Signal" }] }).includes("„Signal“"));
});
