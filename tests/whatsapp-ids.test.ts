import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** WhatsApp messages kept under "<chat>|<time>" keep their row when the same message now arrives with its real id — no duplicates, the key todos cite stays. */
test("a WhatsApp message kept by chat|time is the same row when it comes again with its own id", async () => {
  const { saveMails } = await import("@/lib/mail/store");
  const { getDb, schema } = await import("@/db");
  const at = "2026-10-14T10:00:00.000Z";
  const msg = (id: string, preview = "Kannst du morgen?") => ({ id, convId: "wa:Anna", folder: "WhatsApp", from: "Anna", fromEmail: null, subject: "Anna", preview, receivedAt: at, unread: true, group: false, toMe: false });

  assert.equal(saveMails([msg("1@c.us|1760436000")]).added, 1);
  const before = getDb().select().from(schema.emails).all();
  assert.equal(before.length, 1);

  // The same message with its id (String(id)): not a second row, and the first key stays.
  assert.equal(saveMails([msg("false_1@c.us_ABC123")]).added, 0);
  const after = getDb().select().from(schema.emails).all();
  assert.equal(after.length, 1);
  assert.equal(after[0].key, before[0].key);

  // A new message in the same second of the same chat is no longer swallowed: its own id makes it its own row.
  assert.equal(saveMails([msg("false_1@c.us_DEF456", "Und noch was")]).added, 1);
  assert.equal(getDb().select().from(schema.emails).all().length, 2);
  // … and the messages that now come twice don't multiply.
  assert.equal(saveMails([msg("false_1@c.us_ABC123"), msg("false_1@c.us_DEF456", "Und noch was")]).added, 0);
});
